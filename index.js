const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const { QuickDB } = require('quick.db'); 
const axios = require('axios'); 

const config = {
token: 'MTM2MTU5ODU0NTgxOTMzNjgwNQ.GIk-sN.-QPXvYjChEuDRcmfz8lh9Kmah5MieTk_O792o0',
verificationChannelId: '1361582415226867722', 
autoRoleId: '1361582850360475728', 
verifiedRoleId: '1361582777970987068', 
prefix: '!', 
adminRoleId: '1361728886836297881', 
steamApiKey: 'FF42EC7373FFBC7B3AA8C3BADB9B6152', 
};

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
],
partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
});

const db = new QuickDB();

const UserModel = {

async create(discordId, steamData) {
return await db.set(`users.${discordId}`, {
 discordId,
 steam: steamData,
 verifiedAt: new Date().toISOString(),
 dinosaurs: [], 
 lastActive: new Date().toISOString(),
});
},

async getByDiscordId(discordId) {
return await db.get(`users.${discordId}`);
},

async getBySteamId(steamId) {
const allUsers = await db.get('users') || {};
for (const userId in allUsers) {
 const user = allUsers[userId];

 if ((user.steamId === steamId) || 
     (user.steam && user.steam.id === steamId)) {
   return user;
 }
}
return null;
},

async updateSteamId(discordId, steamData) {
const user = await this.getByDiscordId(discordId);

const steamInfo = typeof steamData === 'string' 
 ? { id: steamData } 
 : steamData;

if (user) {

 user.steam = steamInfo;
 user.lastActive = new Date().toISOString();

 user.steamId = steamInfo.id;

 return await db.set(`users.${discordId}`, user);
}

return await this.create(discordId, steamInfo);
},

async addDinosaur(discordId, dinosaurId) {
const user = await this.getByDiscordId(discordId);
if (user) {
 if (!user.dinosaurs) user.dinosaurs = [];
 user.dinosaurs.push({
   id: dinosaurId,
   acquiredAt: new Date().toISOString(),
 });
 return await db.set(`users.${discordId}`, user);
}
return null;
},

async getAllVerified() {
const allUsers = await db.get('users') || {};
return Object.values(allUsers).filter(user => 
 (user.steamId) || (user.steam && user.steam.id)
);
}
};

const DinosaurModel = {

async getAll() {
return await db.get('dinosaurs') || [];
},

async getById(id) {
const allDinosaurs = await this.getAll();
return allDinosaurs.find(dino => dino.id === id) || null;
},

async create(dinosaurData) {
const dinosaurs = await this.getAll();
dinosaurs.push({
 id: Date.now().toString(), 
 ...dinosaurData,
 createdAt: new Date().toISOString()
});
return await db.set('dinosaurs', dinosaurs);
}
};

const SteamUtils = {

async resolveVanityUrl(vanityUrl) {
try {
 const response = await axios.get('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/', {
   params: {
     key: config.steamApiKey,
     vanityurl: vanityUrl
   }
 });

 const data = response.data;

 if (data.response && data.response.success === 1 && data.response.steamid) {
   return data.response.steamid;
 } else {
   console.error('Nie udało się uzyskać SteamID z vanity URL:', vanityUrl, data.response);
   return null;
 }
} catch (error) {
 console.error('Błąd podczas pobierania SteamID z vanity URL:', error.message);
 return null;
}
},

async getPlayerSummary(steamId64) {
try {
 const response = await axios.get('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/', {
   params: {
     key: config.steamApiKey,
     steamids: steamId64
   }
 });

 const data = response.data;

 if (data.response && data.response.players && data.response.players.length > 0) {
   return data.response.players[0];
 } else {
   console.error('Nie znaleziono informacji o profilu dla SteamID:', steamId64);
   return null;
 }
} catch (error) {
 console.error('Błąd podczas pobierania informacji o profilu Steam:', error.message);
 return null;
}
},

async extractSteamId(steamLink) {
const originalInput = steamLink;

const vanityMatch = steamLink.match(/\/id\/([^\/]+)/);
if (vanityMatch) {
 const vanityUrl = vanityMatch[1];

 const steamId64 = await this.resolveVanityUrl(vanityUrl);

 if (steamId64) {

   const profileInfo = await this.getPlayerSummary(steamId64);

   return { 
     type: 'steamid64', 
     id: steamId64, 
     originalInput,
     profileInfo,
     vanityUrl 
   };
 } else {
   return null; 
 }
}

const profileMatch = steamLink.match(/\/profiles\/(\d+)/);
if (profileMatch) {
 const steamId64 = profileMatch[1];

 const profileInfo = await this.getPlayerSummary(steamId64);

 return { 
   type: 'steamid64', 
   id: steamId64, 
   originalInput,
   profileInfo
 };
}

const steamIdPattern = /^STEAM_[0-5]:[01]:\d+$/;
if (steamIdPattern.test(steamLink)) {

 const steamId64 = this.convertSteamIDToSteamID64(steamLink);

 if (steamId64) {

   const profileInfo = await this.getPlayerSummary(steamId64);

   return { 
     type: 'steamid64', 
     id: steamId64, 
     originalInput,
     profileInfo,
     originalSteamId: steamLink
   };
 } else {

   return { 
     type: 'steamid', 
     id: steamLink, 
     originalInput,
     profileInfo: null
   };
 }
}

const steam64Pattern = /^[0-9]{17}$/;
if (steam64Pattern.test(steamLink)) {

 const profileInfo = await this.getPlayerSummary(steamLink);

 return { 
   type: 'steamid64', 
   id: steamLink, 
   originalInput,
   profileInfo
 };
}

if (!steamLink.includes('/') && !steamLink.includes('steam') && !steamIdPattern.test(steamLink) && !steam64Pattern.test(steamLink)) {

 const steamId64 = await this.resolveVanityUrl(steamLink);

 if (steamId64) {

   const profileInfo = await this.getPlayerSummary(steamId64);

   return { 
     type: 'steamid64', 
     id: steamId64, 
     originalInput,
     profileInfo,
     vanityUrl: steamLink
   };
 }
}

try {
 const url = new URL(steamLink);
 if (url.hostname.includes('steamcommunity.com')) {

   const pathParts = url.pathname.split('/').filter(Boolean);

   if (pathParts.length >= 2) {
     if (pathParts[0] === 'id') {

       const vanityUrl = pathParts[1];
       const steamId64 = await this.resolveVanityUrl(vanityUrl);

       if (steamId64) {

         const profileInfo = await this.getPlayerSummary(steamId64);

         return { 
           type: 'steamid64', 
           id: steamId64, 
           originalInput,
           profileInfo,
           vanityUrl
         };
       }
     } else if (pathParts[0] === 'profiles') {

       const steamId64 = pathParts[1];
       if (/^\d{17}$/.test(steamId64)) {

         const profileInfo = await this.getPlayerSummary(steamId64);

         return { 
           type: 'steamid64', 
           id: steamId64, 
           originalInput,
           profileInfo
         };
       }
     }
   }
 }
} catch (e) {

}

return null;
},

convertSteamIDToSteamID64(steamId) {
try {

 const parts = steamId.split(':');
 if (parts.length !== 3) return null;

 const universe = parseInt(parts[0].replace('STEAM_', ''), 10);
 const authServer = parseInt(parts[1], 10);
 const accountId = parseInt(parts[2], 10);

 const steamId64 = BigInt(76561197960265728) + BigInt(accountId * 2) + BigInt(authServer);
 return steamId64.toString();
} catch (e) {
 console.error('Błąd podczas konwersji SteamID na SteamID64:', e);
 return null;
}
},

isValidSteamLink(steamLink) {

return (
 steamLink.includes('steamcommunity.com/id/') || 
 steamLink.includes('steamcommunity.com/profiles/') ||
 /^STEAM_[0-5]:[01]:\d+$/.test(steamLink) ||
 /^[0-9]{17}$/.test(steamLink) ||

 steamLink.includes('steamcommunity.com') ||

 (!steamLink.includes('/') && !steamLink.includes(' ') && steamLink.length > 2 && steamLink.length < 50)
);
}
};

client.once('ready', async () => {
console.log(`Bot uruchomiony pomyślnie! Zalogowany jako ${client.user.tag}`);

await createOrUpdateVerificationMessage();
});

client.on('guildMemberAdd', async (member) => {
try {

await member.roles.add(config.autoRoleId);
console.log(`Przypisano rolę nowemu członkowi: ${member.user.tag}`);

await sendPingToNewMember(member);

} catch (error) {
console.error('Błąd w zdarzeniu guildMemberAdd:', error);
}
});

async function createOrUpdateVerificationMessage() {
try {

const guild = client.guilds.cache.first();
if (!guild) return null;

const verificationChannel = guild.channels.cache.get(config.verificationChannelId);
if (!verificationChannel) {
 console.error('Kanał weryfikacji nie znaleziony!');
 return null;
}

let verificationMessageId = await db.get('verificationMessageId');
let verificationMessage = null;

if (verificationMessageId) {
 try {

   verificationMessage = await verificationChannel.messages.fetch(verificationMessageId);
 } catch (e) {

   console.log('Nie znaleziono poprzedniej wiadomości weryfikacyjnej, tworzenie nowej...');
 }
}

const verificationEmbed = new EmbedBuilder()
 .setTitle('Weryfikacja Steam')
 .setDescription('Aby uzyskać pełny dostęp do serwera, musisz zweryfikować swoje konto Steam. Kliknij przycisk poniżej, aby rozpocząć proces weryfikacji.')
 .setColor('#0099ff')
 .setTimestamp();

const verifyButton = new ButtonBuilder()
 .setCustomId('verify_button')
 .setLabel('Zweryfikuj')
 .setStyle(ButtonStyle.Primary);

const row = new ActionRowBuilder().addComponents(verifyButton);

if (verificationMessage) {

 await verificationMessage.edit({
   embeds: [verificationEmbed],
   components: [row]
 });
 return verificationMessage;
} else {

 const newMessage = await verificationChannel.send({
   embeds: [verificationEmbed],
   components: [row]
 });

 await db.set('verificationMessageId', newMessage.id);
 return newMessage;
}
} catch (error) {
console.error('Błąd podczas tworzenia/aktualizacji wiadomości weryfikacyjnej:', error);
return null;
}
}

async function sendPingToNewMember(member) {
try {
const verificationChannel = member.guild.channels.cache.get(config.verificationChannelId);

if (!verificationChannel) {
 console.error('Kanał weryfikacji nie znaleziony!');
 return;
}

const message = await verificationChannel.send({
 content: `**${member}**, witaj na serwerze! Sprawdź wiadomość weryfikacyjną powyżej i kliknij przycisk "Zweryfikuj", aby uzyskać pełen dostęp.`,
 allowedMentions: { users: [member.id] }
});

setTimeout(() => {
 message.delete().catch(error => {
   console.error('Nie udało się usunąć wiadomości powitalnej:', error);
 });
}, 3000); 
} catch (error) {
console.error('Błąd podczas wysyłania pinga do nowego członka:', error);
}
}

client.on('interactionCreate', async (interaction) => {
try {

if (interaction.isButton() && interaction.customId === 'verify_button') {
 await handleVerifyButtonClick(interaction);
}

else if (interaction.isModalSubmit() && interaction.customId === 'steam_verification_modal') {
 await handleSteamVerificationModalSubmit(interaction);
}

} catch (error) {
console.error('Błąd w obsłudze interakcji:', error);

if (interaction.isRepliable()) {
 await interaction.reply({
   content: 'Wystąpił błąd podczas przetwarzania twojej prośby. Spróbuj ponownie później.',
   flags: 64 
 });
}
}
});

async function handleVerifyButtonClick(interaction) {

const user = await UserModel.getByDiscordId(interaction.user.id);

if (user && user.steamId) {
return interaction.reply({
 content: 'Twoje konto jest już zweryfikowane!',
 flags: 64 
});
}

const modal = new ModalBuilder()
.setCustomId('steam_verification_modal')
.setTitle('Weryfikacja Steam');

const steamLinkInput = new TextInputBuilder()
.setCustomId('steam_link_input')
.setLabel('Podaj link do swojego profilu Steam')
.setPlaceholder('np. https://steamcommunity.com/id/example')
.setStyle(TextInputStyle.Short)
.setRequired(true);

modal.addComponents(new ActionRowBuilder().addComponents(steamLinkInput));

await interaction.showModal(modal);
}

async function handleSteamVerificationModalSubmit(interaction) {

await interaction.deferReply({ flags: 64 }); 

try {

const steamLink = interaction.fields.getTextInputValue('steam_link_input');

if (!SteamUtils.isValidSteamLink(steamLink)) {
 return interaction.editReply({
   content: 'Nieprawidłowy link do profilu Steam. Spróbuj ponownie z poprawnym linkiem lub identyfikatorem Steam.',
   flags: 64 
 });
}

const steamIdData = await SteamUtils.extractSteamId(steamLink);

if (!steamIdData) {
 return interaction.editReply({
   content: 'Nie udało się przetworzyć linku do profilu Steam. Upewnij się, że podany profil istnieje i jest publiczny.',
   flags: 64 
 });
}

console.log('Dane Steam:', JSON.stringify(steamIdData, null, 2));

const steamData = {
 id: steamIdData.id,
 type: steamIdData.type,
 originalInput: steamIdData.originalInput
};

if (steamIdData.profileInfo) {
 steamData.personaname = steamIdData.profileInfo.personaname;
 steamData.profileurl = steamIdData.profileInfo.profileurl;
 steamData.avatar = steamIdData.profileInfo.avatar;
}

if (steamIdData.vanityUrl) {
 steamData.vanityUrl = steamIdData.vanityUrl;
}

await UserModel.updateSteamId(interaction.user.id, steamData);

const guild = interaction.guild;
const member = guild.members.cache.get(interaction.user.id);

if (member) {

 await member.roles.add(config.verifiedRoleId);

 await member.roles.remove(config.autoRoleId);

 console.log(`Użytkownik ${member.user.tag} został zweryfikowany - dodano rolę zweryfikowanego i usunięto rolę niezweryfikowanego`);
}

let successMessage = 'Twoje konto zostało pomyślnie zweryfikowane! Przyznano Ci rolę zweryfikowanego użytkownika.';

if (steamIdData.profileInfo) {
 successMessage += `\n\nPowiązano z kontem Steam: **${steamIdData.profileInfo.personaname}**`;
}

return interaction.editReply({
 content: successMessage,
 flags: 64 
});
} catch (error) {
console.error('Błąd podczas procesu weryfikacji:', error);
return interaction.editReply({
 content: 'Wystąpił błąd podczas weryfikacji. Prosimy spróbować ponownie później.',
 flags: 64 
});
}
}

client.on('messageCreate', async (message) => {

if (message.author.bot) return;

if (!message.content.startsWith(config.prefix)) return;

const args = message.content.slice(config.prefix.length).trim().split(/ +/);
const commandName = args.shift().toLowerCase();

if (commandName === 'baza') {
await handleDatabaseCommand(message, args);
}
});

async function handleDatabaseCommand(message, args) {
try {

const member = message.member;
if (!member.roles.cache.has(config.adminRoleId)) {
 return message.reply('Nie masz uprawnień do użycia tej komendy.');
}

const dataType = args[0]?.toLowerCase();

if (!dataType || dataType === 'help') {
 return message.reply(
   'Dostępne komendy bazy danych:\n' +
   '`!baza users` - Wyświetla wszystkich zweryfikowanych użytkowników\n' +
   '`!baza user <discord_id>` - Wyświetla informacje o konkretnym użytkowniku\n' +
   '`!baza stats` - Wyświetla statystyki bazy danych\n' + 
   '`!baza dinosaury` - Wyświetla wszystkie dinozaury w bazie (przyszła funkcjonalność)'
 );
}

if (dataType === 'users') {
 const users = await UserModel.getAllVerified();

 if (users.length === 0) {
   return message.reply('Brak zweryfikowanych użytkowników w bazie danych.');
 }

 const userInfo = users.map(user => {
   return `**Discord ID:** ${user.discordId}, **Steam ID:** ${user.steamId}, **Zweryfikowano:** ${new Date(user.verifiedAt).toLocaleString()}`;
 }).join('\n');

 if (userInfo.length > 1900) {

   const chunks = [];
   let tempString = '';

   userInfo.split('\n').forEach(line => {
     if ((tempString + line).length > 1900) {
       chunks.push(tempString);
       tempString = line + '\n';
     } else {
       tempString += line + '\n';
     }
   });

   if (tempString.length > 0) {
     chunks.push(tempString);
   }

   for (const chunk of chunks) {
     await message.channel.send(chunk);
   }
 } else {
   await message.reply(userInfo);
 }

 return;
}

if (dataType === 'user') {
 const userId = args[1];
 if (!userId) {
   return message.reply('Musisz podać ID Discorda użytkownika. Użycie: `!baza user <discord_id>`');
 }

 const user = await UserModel.getByDiscordId(userId);
 if (!user) {
   return message.reply(`Nie znaleziono użytkownika o ID: ${userId}`);
 }

 const userEmbed = new EmbedBuilder()
   .setTitle('Informacje o użytkowniku')
   .setColor('#0099ff')
   .addFields(
     { name: 'Discord ID', value: user.discordId || 'Brak' },
     { name: 'Steam ID', value: user.steamId || (user.steam ? user.steam.id : 'Brak') },
     { name: 'Data weryfikacji', value: user.verifiedAt ? new Date(user.verifiedAt).toLocaleString() : 'Brak' },
     { name: 'Ostatnia aktywność', value: user.lastActive ? new Date(user.lastActive).toLocaleString() : 'Brak' },
     { name: 'Liczba dinozaurów', value: (user.dinosaurs && user.dinosaurs.length) ? user.dinosaurs.length.toString() : '0' }
   );

 if (user.steam && user.steam.personaname) {
   userEmbed.addFields({ name: 'Nazwa konta Steam', value: user.steam.personaname });
 }

 if (user.dinosaurs && user.dinosaurs.length > 0) {
   let dinosaursText = user.dinosaurs.map(dino => 
     `ID: ${dino.id}, Zdobyty: ${new Date(dino.acquiredAt).toLocaleString()}`
   ).join('\n');

   if (dinosaursText.length > 1024) {
     dinosaursText = dinosaursText.substring(0, 1020) + '...';
   }

   userEmbed.addFields({ name: 'Dinozaury', value: dinosaursText });
 }

 await message.reply({ embeds: [userEmbed] });
 return;
}

if (dataType === 'stats') {
 const users = await UserModel.getAllVerified();
 const allUsers = await db.get('users') || {};
 const totalUsers = Object.keys(allUsers).length;
 const verifiedUsers = users.length;

 const dinosaurs = await DinosaurModel.getAll();
 const dinosaurCount = dinosaurs.length;

 const statsEmbed = new EmbedBuilder()
   .setTitle('Statystyki bazy danych')
   .setColor('#0099ff')
   .addFields(
     { name: 'Liczba użytkowników', value: totalUsers.toString() },
     { name: 'Zweryfikowani użytkownicy', value: verifiedUsers.toString() },
     { name: 'Niezweryfikowani użytkownicy', value: (totalUsers - verifiedUsers).toString() },
     { name: 'Liczba dinozaurów', value: dinosaurCount.toString() },
     { name: 'Status bazy danych', value: 'Aktywna' }
   )
   .setTimestamp();

 await message.reply({ embeds: [statsEmbed] });
 return;
}

if (dataType === 'dinosaury') {
 const dinosaurs = await DinosaurModel.getAll();

 if (dinosaurs.length === 0) {
   return message.reply('Brak dinozaurów w bazie danych. Ta funkcjonalność będzie dostępna w przyszłości.');
 }

 const dinosaurEmbed = new EmbedBuilder()
   .setTitle('Lista dinozaurów w bazie danych')
   .setColor('#0099ff')
   .setDescription(`Znaleziono ${dinosaurs.length} dinozaurów:`);

 const displayCount = Math.min(dinosaurs.length, 25);

 for (let i = 0; i < displayCount; i++) {
   const dino = dinosaurs[i];
   dinosaurEmbed.addFields({
     name: `ID: ${dino.id}`,
     value: `Typ: ${dino.type || 'N/A'}\nStworzony: ${new Date(dino.createdAt).toLocaleString()}`
   });
 }

 if (dinosaurs.length > 25) {
   dinosaurEmbed.setFooter({ text: `Wyświetlono 25 z ${dinosaurs.length} dinozaurów` });
 }

 await message.reply({ embeds: [dinosaurEmbed] });
 return;
}

await message.reply('Nieprawidłowa komenda bazy danych. Użyj `!baza help` aby zobaczyć dostępne opcje.');

} catch (error) {
console.error('Błąd podczas obsługi komendy bazy danych:', error);
await message.reply('Wystąpił błąd podczas przetwarzania komendy. Spróbuj ponownie później.');
}
}

client.login(config.token);