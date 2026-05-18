import { REST, Routes } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOKEN = Bun.env.TOKEN;
if (!TOKEN) {
  console.error("blowing my shit smoove off");
  process.exit(1);
}
const CLIENT_ID = Bun.env.CLIENT_ID;
if (!CLIENT_ID) {
  console.error("blowing my shit smoove off");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands: any[] = [];
const foldersPath = path.join(__dirname, "commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".ts"));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);

    // IMPORTANT: import needs a file:// URL when you have an absolute path
    const mod = await import(pathToFileURL(filePath).href);

    // If your command files use `export default { data, execute }`
    const command = mod.default ?? mod;

    if ("data" in command && "execute" in command) {
      commands.push(command.data.toJSON());
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
      );
    }
  }
}

const rest = new REST().setToken(TOKEN);

try {
  console.log(
    `Started refreshing ${commands.length} application (/) commands.`,
  );

  const data: any = await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: commands,
  });

  console.log(`Successfully reloaded ${data.length} application (/) commands.`);
} catch (error) {
  console.error(error);
}
