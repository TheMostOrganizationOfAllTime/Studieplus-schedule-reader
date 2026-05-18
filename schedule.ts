import fs from 'node:fs/promises'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { htmlToDiscord } from './discordformatting.js'

export async function fetchAllSchedule(date: string) {
    const text = await fs.readFile('./data.json')
    const data = JSON.parse(text.toString()) as Data[]
    const fullSchedule: Class[] = []
    const schedules = await Promise.all(
        data.map(d => fetchSchedule({ name: d.username, password: d.password }, date, d.cookie)),
    )
    schedules.forEach(schedule => {
        fullSchedule.push(...schedule)
    })
    fullSchedule[0]?.startTime()
    return Class.collect(fullSchedule).sort((a, b) => a.startTime() - b.startTime())
}

export async function fetchSchedule(
    user: { name: string; password: string },
    date: string,
    cookie?: { value: string; expiration: number },
): Promise<Class[]> {
    const URL = 'https://all.uddataplus.dk/skema/?id=id_menu_skema#u:e!122922!' + date

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--disable-features=BlockThirdPartyCookies',
            '--disable-features=SameSiteByDefaultCookies',
            '--disable-features=CookiesWithoutSameSiteMustBeSecure',
        ],
    })
    const context = await browser.newContext()
    const page = await context.newPage()
    await context.addCookies([
        {
            name: 'instkey',
            value: '630064991',
            domain: 'all.uddataplus.dk',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax',
        },
        {
            name: 'instnr',
            value: '281075',
            domain: 'all.uddataplus.dk',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax',
        },
    ])
    cookie ??= await updateCookie(user.name, user.password, page, context)
    await context.addCookies([
        {
            name: 'utoken',
            value: cookie.value,
            domain: 'all.uddataplus.dk',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
            expires: cookie.expiration,
        },
    ])

    await page.goto(URL, { waitUntil: 'networkidle' })
    if (page.url().includes('&returURL=')) {
        cookie = await updateCookie(user.name, user.password, page, context)
        await page.goto(URL, { waitUntil: 'networkidle' })
    } else if (page.url() !== URL) {
        throw new Error(`Unknown Error. Mismatched URL: ${page.url()}`)
    }
    await page.waitForSelector('svg', { timeout: 15_000 })

    const today = page
        .locator('svg')
        .locator('g.DagMedBrikker')
        .nth(new Date(date).getDay() - 1)
        .locator('> g')
    const info: Class[] = []
    const classes = today.locator('> g')
    const classCount = await classes.count()
    for (let i = 0; i < classCount; i++) {
        const c = new Class()
        await classes.nth(i).click({ force: true })
        let str = (await page.locator('div.gwt-HTML').textContent()) ?? ''
        if (/^Lektion \d: /u.test(str)) {
            str = str.slice(11)
        }
        const strings = str.split('   ')
        strings.forEach(s => {
            if (s !== '') {
                if (s.startsWith('Lærer: ')) {
                    c.teachers = [s.slice(7)]
                } else if (s.startsWith('Lærere: ')) {
                    c.teachers = s.slice(8).split(', ')
                } else if (s.startsWith('Lokale: ')) {
                    c.rooms = [s.slice(8)]
                } else if (s.startsWith('Lokaler: ')) {
                    c.rooms = s.slice(9).split(', ')
                } else if (s.startsWith('Holdet: ')) {
                    c.groups = [s.slice(8)]
                } else if (s.startsWith('Hold: ')) {
                    c.groups = s.slice(6).split(', ')
                } else if (s.startsWith('Bemærkning: ')) {
                    c.remarks = s.slice(12)
                } else {
                    const time = /\d{2}:\d{2} - \d{2}:\d{2}/u.exec(s)
                    if (time) {
                        ;[c.time] = time
                        c.name = s.slice(time[0].length + 2) //.split(", ");
                    } else {
                        throw new Error('Unknown schedule data ' + s)
                    }
                }
            }
        })

        const actions = classes.nth(i).locator('g.actionMenu > g > rect.CAHE1CD-v-j')
        await actions.filter({ hasText: 'flere handlinger' }).click({ force: true })
        const popup = page.locator('div.popupContent')
        const note = popup
            .locator('div.modal-body')
            .locator('div.CAHE1CD-i-r.CAHE1CD-i-G.CAHE1CD-i-P.CAHE1CD-i-k.CAHE1CD-i-f.CAHE1CD-v-b')
            .filter({ hasText: 'Vis note' })
        if ((await note.count()) > 0) {
            await note.click({ force: true })
            await page.waitForSelector('form.form-horizontal', { timeout: 15_000 })
            const popupInfos = popup.locator('form.form-horizontal > div.control-group')
            const infos = await popupInfos.count()
            for (let k = 0; k < infos; k++) {
                const relevant = popupInfos
                    .nth(k)
                    .locator('div.controls div.always-visible.ps-container')
                switch (await popupInfos.nth(k).locator('label.control-label').textContent()) {
                    case 'Note':
                        if ((await relevant.locator('div.gwt-HTML > *').count()) > 0) {
                            c.notes = htmlToDiscord(
                                await relevant.locator('div.gwt-HTML').innerHTML(),
                            )
                        }
                        break
                    case 'Lektie':
                        if ((await relevant.locator('div.gwt-HTML > *').count()) > 0) {
                            c.homework = htmlToDiscord(
                                await relevant.locator('div.gwt-HTML').innerHTML(),
                            )
                        }
                        break
                    case 'Filer': {
                        const loc = relevant.locator(
                            'div.CAHE1CD-i-r.CAHE1CD-i-P.CAHE1CD-i-k.CAHE1CD-i-f.CAHE1CD-I-c.CAHE1CD-I-E.CAHE1CD-i-t',
                        )
                        if ((await loc.count()) > 0) {
                            const files = await loc
                                .locator(' > div')
                                .filter({ hasNotText: 'Mappen indeholder ingen filer' })
                                .count()
                            for (let o = 0; o < files; o++) {
                                c.files.push(
                                    ((await loc
                                        .locator(' > div')
                                        .nth(o)
                                        .locator('a')
                                        .textContent()) ?? '') +
                                        ((await loc
                                            .locator(
                                                ' > div div.CAHE1CD-i-P.CAHE1CD-I-l.CAHE1CD-i-h',
                                            )
                                            .nth(o)
                                            .locator('div')
                                            .textContent()) ?? ''),
                                )
                                const requestPromise = page.waitForRequest(req =>
                                    req.url().includes('cellar-c2.services.clever-cloud.com'),
                                )
                                await loc.locator(' > div').nth(o).locator('a').click()
                                c.fileUrls.push((await requestPromise).url())
                            }
                        }
                        break
                    }
                }
            }
            await popup.locator('a.close').click()
        }
        info.push(c)
    }

    await browser.close()
    return info
}

export async function login(username: string, password: string, page: Page) {
    await page.goto('https://all.uddataplus.dk/login/')
    await page.locator('input#huskmig').waitFor()
    await page.locator('label[for="huskmig"]').click()
    await Promise.all([
        page.waitForURL(/broker\.unilogin\.dk/u, {
            timeout: 10_000,
        }),
        page.locator('button#unilogin').click(),
    ])

    await page.locator('button.button-secondary').first().waitFor()
    const buttons = page.locator('button.button-secondary')
    const count = await buttons.count()
    for (let i = 0; i < count; i++) {
        const button = buttons.nth(i)
        if ((await button.locator('img[alt="Unilogin"]').count()) > 0) {
            await Promise.all([
                page.waitForURL(/idp\.unilogin\.dk/u, {
                    timeout: 10_000,
                }),
                button.click(),
            ])
            break
        }
    }

    await page.locator('input#username').waitFor()
    await page.locator('input#username').fill(username)
    await page.locator('button.button-primary.js-cta-submit').click()

    await page.locator('input[type="password"]').waitFor({
        timeout: 10_000,
    })
    await page.locator('input[type="password"]').waitFor()
    await page.locator('input[type="password"]').fill(password)
    await Promise.all([
        page.waitForURL(/all\.uddataplus\.dk\/skema/u, {
            timeout: 10_000,
        }),
        page.locator('button.button-primary.js-cta-submit').click(),
    ])
}

export async function updateCookie(
    username: string,
    password: string,
    cookie: { value: string; expiration: number },
): Promise<{ value: string; expiration: number }>
export async function updateCookie(
    username: string,
    password: string,
    page: Page,
    context: BrowserContext,
): Promise<{ value: string; expiration: number }>
export async function updateCookie(
    username: string,
    password: string,
    cookiePage: { value: string; expiration: number } | Page,
    context?: BrowserContext,
): Promise<{ value: string; expiration: number }> {
    if (context) {
        await login(username, password, cookiePage as Page)
        const newCookie = (await context.cookies()).find(c => c.name === 'utoken')
        if (!newCookie) {
            throw new Error('Failed Login')
        }
        const text = await fs.readFile('./data.json')
        const data = JSON.parse(text.toString()) as Data[]
        const user = data.find(u => u.username === username && u.password === password)
        if (!user) {
            throw new Error("Couldn't find user")
        }
        user.cookie = {
            expiration: newCookie.expires,
            value: newCookie.value,
        }
        await fs.writeFile('./data.json', JSON.stringify(data))
        return user.cookie
    } else {
        const text = await fs.readFile('./data.json')
        const data = JSON.parse(text.toString()) as Data[]
        const user = data.find(d => d.username === username && d.password === password)
        if (!user) {
            throw new Error("Couldn't find user")
        }
        user.cookie = cookiePage as { value: string; expiration: number }
        await fs.writeFile('./data.json', JSON.stringify(data))
        return user.cookie
    }
}

class Class {
    time: string | undefined = undefined
    teachers: string[] = []
    groups: string[] = []
    rooms: string[] = []
    name: string | undefined = undefined
    homework: string | undefined = undefined
    notes: string | undefined = undefined
    remarks: string | undefined = undefined
    files: string[] = []
    fileUrls: string[] = []

    isIdentical(other: Class): boolean {
        if (
            this.teachers.length !== other.teachers.length ||
            this.groups.length !== other.groups.length
        ) {
            return false
        }
        for (let i = 0; i < this.teachers.length; i++) {
            if (this.teachers[i] !== other.teachers[i]) {
                return false
            }
        }
        for (let i = 0; i < this.groups.length; i++) {
            if (this.groups[i] !== other.groups[i]) {
                return false
            }
        }
        return this.canBeMerged(other)
    }

    canBeMerged(other: Class): boolean {
        if (
            this.time !== other.time ||
            this.name !== other.name ||
            this.homework !== other.homework ||
            this.notes !== other.notes ||
            this.remarks !== other.remarks ||
            this.rooms.length !== other.rooms.length ||
            this.files.length !== other.files.length ||
            this.fileUrls.length !== other.fileUrls.length
        ) {
            return false
        }
        for (let i = 0; i < this.rooms.length; i++) {
            if (this.rooms[i] !== other.rooms[i]) {
                return false
            }
        }
        for (let i = 0; i < this.files.length; i++) {
            if (this.files[i] !== other.files[i]) {
                return false
            }
        }
        for (let i = 0; i < this.fileUrls.length; i++) {
            if (this.fileUrls[i] !== other.fileUrls[i]) {
                return false
            }
        }

        return true
    }

    forceMerge(other: Class): void {
        this.teachers.push(...other.teachers.filter(t => !this.teachers.includes(t)))
        this.groups.push(...other.groups.filter(g => !this.groups.includes(g)))
    }

    public static collect(classes: Class[]): Class[] {
        const schedule: Class[] = []
        for (let i = 0; i < classes.length; i++) {
            const current = classes[i]
            if (!current) {
                continue
            }
            let skip = false
            for (let j = i + 1; j < classes.length; j++) {
                const other = classes[j]
                if (!other) {
                    continue
                }
                if (current.canBeMerged(other)) {
                    skip = true
                    if (!current.isIdentical(other)) {
                        other.forceMerge(current)
                    }
                    break
                }
            }
            if (!skip) {
                schedule.push(current)
            }
        }
        return schedule
    }

    public startTime(): number {
        const time = this.time?.split(' - ')[0]?.split(':')
        if (
            time?.length !== 2 ||
            !time[0] ||
            !time[1] ||
            !/\d+/u.test(time[0]) ||
            !/\d+/u.test(time[1])
        ) {
            if (!this.time) {
                throw new Error('No Timespan')
            }
            throw new Error(`Invalid Timespan: ${this.time}`)
        }
        return Number(time[0]) * 60 + Number(time[1])
    }
}

type Data = {
    cookie: { value: string; expiration: number }
    username: string
    password: string
}
