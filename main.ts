/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import express from 'express'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { fetchAllSchedule, updateCookie } from './schedule.js'

const app = express()
const port = 3000
app.use(express.json())

// get schedule of today
app.get('/today', async (_req, res) => {
    res.json(await fetchAllSchedule(new Date().toISOString().slice(0, 10)))
})

// get schedule of tomorrow
app.get('/tomorrow', async (_req, res) => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    res.json(await fetchAllSchedule(tomorrow.toISOString().slice(0, 10)))
})

// get schedule of specific date
app.post('/get', async (req, res) => {
    const { date } = req.body
    if (date) {
        res.status(200)
        res.json(await fetchAllSchedule(date as string))
    } else {
        res.status(400)
        res.send('Invalid Body')
    }
})

// add user
app.post('/adduser', async (req, res) => {
    const { username, password } = req.body
    if (username && password) {
        const context = await (
            await chromium.launch({
                headless: true,
                args: [
                    '--disable-features=BlockThirdPartyCookies',
                    '--disable-features=SameSiteByDefaultCookies',
                    '--disable-features=CookiesWithoutSameSiteMustBeSecure',
                ],
            })
        ).newContext()
        let data: Data | undefined
        try {
            data = {
                username,
                password,
                cookie: await updateCookie(
                    username as string,
                    password as string,
                    await context.newPage(),
                    context,
                ),
            }
        } catch {
            res.status(400)
            res.send('Login failed (Propably Invalid username or password)')
        }
        if (data) {
            await fs.writeFile(
                './data.json',
                JSON.stringify(
                    (JSON.parse((await fs.readFile('./data.json')).toString()) as Data[]).push(
                        data,
                    ),
                ),
            )
            res.status(200)
            res.send('Succesfully added user')
        }
        res.status(400)
        res.send('You have succesfully reached an impossible Error, congrats!')
    } else {
        res.status(400)
        res.send('Invalid Body')
    }
})

type Data = {
    cookie: { value: string; expiration: number }
    username: string
    password: string
}

app.listen(port, () => {
    console.log(`Server running on port ${port}`)
})
