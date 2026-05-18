import { SlashCommandBuilder } from '@discordjs/builders'
import { ChatInputCommandInteraction, MessageFlags, type CacheType } from 'discord.js'

export default {
    data: new SlashCommandBuilder()
        .setName('login')
        .setDescription('Login med dine Studie+ cookies')
        .addStringOption(option =>
            option.setName('cookies').setDescription('Dine cookies').setRequired(true),
        ),

    async execute(interaction: ChatInputCommandInteraction<CacheType>) {
        console.log('THis is a command')
    },
}
