import {
    Client,
    Collection,
    Events,
    GatewayIntentBits,
    MessageFlags,
    type SendableChannels,
} from 'discord.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

class CustomClient extends Client {
    commands: Collection<string, any>
    constructor(options: any) {
        super(options)
        this.commands = new Collection()
    }
}

export const client = new CustomClient({
    intents: [GatewayIntentBits.DirectMessages],
})

client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`)
})

client.commands = new Collection()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const foldersPath = path.join(__dirname, 'commands')
const commandFolders = fs.readdirSync(foldersPath)

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder)
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts'))

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file)

        const mod = await import(pathToFileURL(filePath).href)

        const command = mod.default

        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command)
        } else {
            console.log(
                `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
            )
        }
    }
}

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return

    const command = (interaction.client as CustomClient).commands.get(interaction.commandName)

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`)
        return
    }

    try {
        await command.execute(interaction)
    } catch (error) {
        console.error(error)
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: 'There was an error while executing this command!',
                flags: MessageFlags.Ephemeral,
            })
        } else {
            await interaction.reply({
                content: 'There was an error while executing this command!',
                flags: MessageFlags.Ephemeral,
            })
        }
    }
})

console.log(client.commands)

const token = Bun.env.TOKEN

if (!token) {
    console.error('blowing my shit smoove off')
    process.exit(1)
}

client.login(token)
