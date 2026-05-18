const { REST, Routes } = require("discord.js");

const rest = new REST().setToken(Bun.env.TOKEN);

// ...

// for guild-based commands
// for global commands
rest
  .put(Routes.applicationCommands(Bun.env.CLIENT_ID), { body: [] })
  .then(() => console.log("Successfully deleted all application commands."))
  .catch(console.error);
