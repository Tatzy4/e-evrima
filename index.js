// Wymagane pakiety Discord.js
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const { QuickDB } = require('quick.db'); // Prosta baza danych, można zamienić na MongoDB w przyszłości
const axios = require('axios'); // Do wykonywania zapytań HTTP do Steam API

// Konfiguracja bota
const config = {
token: 'MTM2MTU5ODU0NTgxOTMzNjgwNQ.GIk-sN.-QPXvYjChEuDRcmfz8lh9Kmah5MieTk_O792o0',
verificationChannelId: '1361582415226867722', // ID kanału weryfikacji
autoRoleId: '1361582850360475728', // ID roli nadawanej automatycznie
verifiedRoleId: '1361582777970987068', // ID roli nadawanej po weryfikacji
prefix: '!', // Prefix komend
adminRoleId: '1361728886836297881', // ID roli administratora (zmień na właściwe)
steamApiKey: 'FF42EC7373FFBC7B3AA8C3BADB9B6152', // Klucz API Steam - uzyskaj go na https://steamcommunity.com/dev/apikey
};

// Inicjalizacja klienta Discord z odpowiednimi uprawnieniami
const client = new Client({
intents: [
 GatewayIntentBits.Guilds,
 GatewayIntentBits.GuildMembers,
 GatewayIntentBits.GuildMessages,
 GatewayIntentBits.MessageContent,
],
partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
});

// Inicjalizacja bazy danych
const db = new QuickDB();

/**
* Model użytkownika - obsługuje przechowywanie i pobieranie danych użytkownika
*/
const UserModel = {
/**
* Tworzy nowego użytkownika w bazie danych
* @param {string} discordId - ID użytkownika Discord
* @param {Object} steamData - Obiekt zawierający dane Steam użytkownika
* @returns {Promise<Object>} Utworzony obiekt użytkownika
*/
async create(discordId, steamData) {
 return await db.set(`users.${discordId}`, {
   discordId,
   steam: steamData,
   verifiedAt: new Date().toISOString(),
   dinosaurs: [], // Przygotowane na przyszłość
   lastActive: new Date().toISOString(),
 });
},

/**
* Pobiera użytkownika po ID Discord
* @param {string} discordId - ID użytkownika Discord
* @returns {Promise<Object|null>} Obiekt użytkownika lub null, jeśli nie znaleziono
*/
async getByDiscordId(discordId) {
 return await db.get(`users.${discordId}`);
},

/**
* Pobiera użytkownika po ID Steam
* @param {string} steamId - ID konta Steam
* @returns {Promise<Object|null>} Obiekt użytkownika lub null
*/
async getBySteamId(steamId) {
 const allUsers = await db.get('users') || {};
 for (const userId in allUsers) {
   const user = allUsers[userId];
   // Sprawdź zarówno stary format jak i nowy format steamId
   if ((user.steamId === steamId) || 
       (user.steam && user.steam.id === steamId)) {
     return user;
   }
 }
 return null;
},

/**
* Aktualizuje lub tworzy dane Steam użytkownika
* @param {string} discordId - ID użytkownika Discord
* @param {Object|string} steamData - Dane Steam lub ID Steam
* @returns {Promise<Object>} Zaktualizowany obiekt użytkownika
*/
async updateSteamId(discordId, steamData) {
 const user = await this.getByDiscordId(discordId);
 
 // Obsługa zarówno starego (string) jak i nowego (object) formatu steamData
 const steamInfo = typeof steamData === 'string' 
   ? { id: steamData } 
   : steamData;
 
 if (user) {
   // Zaktualizuj dane Steam i datę ostatniej aktywności
   user.steam = steamInfo;
   user.lastActive = new Date().toISOString();
   
   // Dla wstecznej kompatybilności - przechowujemy również steamId jako osobne pole
   user.steamId = steamInfo.id;
   
   return await db.set(`users.${discordId}`, user);
 }
 
 // Jeśli użytkownik nie istnieje, utwórz nowy rekord
 return await this.create(discordId, steamInfo);
},

/**
* Dodaje dinozaura do kolekcji użytkownika (do przyszłego użycia)
* @param {string} discordId - ID użytkownika Discord
* @param {string} dinosaurId - Identyfikator dinozaura
* @returns {Promise<Object|null>} Zaktualizowany obiekt użytkownika lub null
*/
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

/**
* Pobiera wszystkich zweryfikowanych użytkowników
* @returns {Promise<Array>} Tablica obiektów użytkowników
*/
async getAllVerified() {
 const allUsers = await db.get('users') || {};
 return Object.values(allUsers).filter(user => 
   (user.steamId) || (user.steam && user.steam.id)
 );
}
};

/**
* Model dinozaura (do przyszłego użycia)
*/
const DinosaurModel = {
/**
* Pobiera wszystkie dinozaury
* @returns {Promise<Array>} Tablica obiektów dinozaurów
*/
async getAll() {
 return await db.get('dinosaurs') || [];
},

/**
* Pobiera dinozaura po ID
* @param {string} id - ID dinozaura
* @returns {Promise<Object|null>} Obiekt dinozaura lub null
*/
async getById(id) {
 const allDinosaurs = await this.getAll();
 return allDinosaurs.find(dino => dino.id === id) || null;
},

/**
* Tworzy nowy typ dinozaura
* @param {Object} dinosaurData - Dane dinozaura
* @returns {Promise<Array>} Zaktualizowana lista dinozaurów
*/
async create(dinosaurData) {
 const dinosaurs = await this.getAll();
 dinosaurs.push({
   id: Date.now().toString(), // Proste generowanie ID
   ...dinosaurData,
   createdAt: new Date().toISOString()
 });
 return await db.set('dinosaurs', dinosaurs);
}
};

/**
* Narzędzia do obsługi Steam
*/
const SteamUtils = {
/**
* Pobiera prawdziwy SteamID64 z vanity URL (niestandardowy URL profilu)
* @param {string} vanityUrl - Niestandardowa nazwa użytkownika Steam z URL
* @returns {Promise<string|null>} - SteamID64 lub null, jeśli nie znaleziono
*/
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

/**
* Sprawdza informacje o profilu Steam na podstawie SteamID64
* @param {string} steamId64 - SteamID64 użytkownika Steam
* @returns {Promise<Object|null>} - Dane profilu lub null w przypadku błędu
*/
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

/**
* Wyciąga ID Steam z różnych formatów linków i konwertuje je na SteamID64 jeśli to możliwe
* @param {string} steamLink - Link do profilu Steam lub ID
* @returns {Promise<{type: string, id: string, originalInput: string, profileInfo: Object|null}|null>} Informacje o wyodrębnionym ID Steam lub null
*/
async extractSteamId(steamLink) {
 const originalInput = steamLink;
 
 // Obsługa adresów vanity (np. https://steamcommunity.com/id/example)
 const vanityMatch = steamLink.match(/\/id\/([^\/]+)/);
 if (vanityMatch) {
   const vanityUrl = vanityMatch[1];
   // Konwertuj vanity URL na SteamID64 przez API
   const steamId64 = await this.resolveVanityUrl(vanityUrl);
   
   if (steamId64) {
     // Pobierz dodatkowe informacje o profilu
     const profileInfo = await this.getPlayerSummary(steamId64);
     
     return { 
       type: 'steamid64', 
       id: steamId64, 
       originalInput,
       profileInfo,
       vanityUrl // Zachowujemy też oryginalny vanity URL
     };
   } else {
     return null; // Nie udało się uzyskać SteamID64
   }
 }
 
 // Obsługa bezpośrednich adresów URL profilu (np. https://steamcommunity.com/profiles/76561198123456789)
 const profileMatch = steamLink.match(/\/profiles\/(\d+)/);
 if (profileMatch) {
   const steamId64 = profileMatch[1];
   // Pobierz dodatkowe informacje o profilu
   const profileInfo = await this.getPlayerSummary(steamId64);
   
   return { 
     type: 'steamid64', 
     id: steamId64, 
     originalInput,
     profileInfo
   };
 }
 
 // Obsługa bezpośredniego wprowadzania SteamID (np. STEAM_0:1:12345678)
 const steamIdPattern = /^STEAM_[0-5]:[01]:\d+$/;
 if (steamIdPattern.test(steamLink)) {
   // Konwersja SteamID na SteamID64
   const steamId64 = this.convertSteamIDToSteamID64(steamLink);
   
   if (steamId64) {
     // Pobierz dodatkowe informacje o profilu
     const profileInfo = await this.getPlayerSummary(steamId64);
     
     return { 
       type: 'steamid64', 
       id: steamId64, 
       originalInput,
       profileInfo,
       originalSteamId: steamLink
     };
   } else {
     // Jeśli konwersja się nie powiedzie, używamy oryginalnego ID
     return { 
       type: 'steamid', 
       id: steamLink, 
       originalInput,
       profileInfo: null
     };
   }
 }
 
 // Obsługa Steam ID64 (17-cyfrowy numer)
 const steam64Pattern = /^[0-9]{17}$/;
 if (steam64Pattern.test(steamLink)) {
   // Pobierz dodatkowe informacje o profilu
   const profileInfo = await this.getPlayerSummary(steamLink);
   
   return { 
     type: 'steamid64', 
     id: steamLink, 
     originalInput,
     profileInfo
   };
 }
 
 // Sprawdź, czy użytkownik podał tylko nazwę bez pełnego URL
 if (!steamLink.includes('/') && !steamLink.includes('steam') && !steamIdPattern.test(steamLink) && !steam64Pattern.test(steamLink)) {
   // Traktuj jako vanity URL i spróbuj rozwiązać
   const steamId64 = await this.resolveVanityUrl(steamLink);
   
   if (steamId64) {
     // Pobierz dodatkowe informacje o profilu
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
 
 // Obsługa pełnego URL Steam z niestandardowymi ścieżkami
 // Próbujemy wyodrębnić jakikolwiek identyfikator z URL i sprawdzić, czy to działa
 try {
   const url = new URL(steamLink);
   if (url.hostname.includes('steamcommunity.com')) {
     // Sprawdź, czy to jest URL /id/ czy /profiles/
     const pathParts = url.pathname.split('/').filter(Boolean);
     
     if (pathParts.length >= 2) {
       if (pathParts[0] === 'id') {
         // To jest vanity URL
         const vanityUrl = pathParts[1];
         const steamId64 = await this.resolveVanityUrl(vanityUrl);
         
         if (steamId64) {
           // Pobierz dodatkowe informacje o profilu
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
         // To jest URL profilu z bezpośrednim SteamID64
         const steamId64 = pathParts[1];
         if (/^\d{17}$/.test(steamId64)) {
           // Pobierz dodatkowe informacje o profilu
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
   // Ignoruj błędy parsowania URL
 }
 
 return null;
},

/**
* Konwertuje SteamID na SteamID64
* @param {string} steamId - SteamID w formacie STEAM_X:Y:Z
* @returns {string|null} - SteamID64 lub null, jeśli konwersja się nie powiedzie
*/
convertSteamIDToSteamID64(steamId) {
 try {
   // Format SteamID: STEAM_X:Y:Z
   const parts = steamId.split(':');
   if (parts.length !== 3) return null;
   
   const universe = parseInt(parts[0].replace('STEAM_', ''), 10);
   const authServer = parseInt(parts[1], 10);
   const accountId = parseInt(parts[2], 10);
   
   // Formuła konwersji: 76561197960265728 + accountId*2 + authServer
   const steamId64 = BigInt(76561197960265728) + BigInt(accountId * 2) + BigInt(authServer);
   return steamId64.toString();
 } catch (e) {
   console.error('Błąd podczas konwersji SteamID na SteamID64:', e);
   return null;
 }
},

/**
* Sprawdza poprawność formatu linku Steam
* @param {string} steamLink - Link do profilu Steam lub ID
* @returns {boolean} Czy link jest prawdopodobnie poprawny
*/
isValidSteamLink(steamLink) {
 // Rozszerzona walidacja, żeby akceptować więcej różnych formatów
 return (
   steamLink.includes('steamcommunity.com/id/') || 
   steamLink.includes('steamcommunity.com/profiles/') ||
   /^STEAM_[0-5]:[01]:\d+$/.test(steamLink) ||
   /^[0-9]{17}$/.test(steamLink) ||
   // Obsługa pełnych URL
   steamLink.includes('steamcommunity.com') ||
   // Akceptujemy proste nazwy jako potencjalne vanity URL
   (!steamLink.includes('/') && !steamLink.includes(' ') && steamLink.length > 2 && steamLink.length < 50)
 );
}
};

// Gdy bot jest gotowy
client.once('ready', async () => {
console.log(`Bot uruchomiony pomyślnie! Zalogowany jako ${client.user.tag}`);

// Utworzenie lub aktualizacja stałej wiadomości weryfikacyjnej
await createOrUpdateVerificationMessage();
});

// Obsługa nowych członków dołączających do serwera
client.on('guildMemberAdd', async (member) => {
try {
 // Automatyczne przypisanie roli
 await member.roles.add(config.autoRoleId);
 console.log(`Przypisano rolę nowemu członkowi: ${member.user.tag}`);
 
 // Wysłanie pinga do kanału weryfikacji, który znika po 3 sekundach
 await sendPingToNewMember(member);
 
} catch (error) {
 console.error('Błąd w zdarzeniu guildMemberAdd:', error);
}
});

/**
* Tworzy lub aktualizuje stałą wiadomość weryfikacyjną na kanale
* @returns {Promise<Message|null>} Wiadomość weryfikacyjna lub null
*/
async function createOrUpdateVerificationMessage() {
try {
 // Pobieranie kanału weryfikacji
 const guild = client.guilds.cache.first();
 if (!guild) return null;
 
 const verificationChannel = guild.channels.cache.get(config.verificationChannelId);
 if (!verificationChannel) {
   console.error('Kanał weryfikacji nie znaleziony!');
   return null;
 }
 
 // Sprawdzenie, czy istnieje już stała wiadomość weryfikacyjna (przechowujemy jej ID w bazie danych)
 let verificationMessageId = await db.get('verificationMessageId');
 let verificationMessage = null;
 
 if (verificationMessageId) {
   try {
     // Próba pobrania istniejącej wiadomości
     verificationMessage = await verificationChannel.messages.fetch(verificationMessageId);
   } catch (e) {
     // Wiadomość mogła zostać usunięta, więc stworzymy nową
     console.log('Nie znaleziono poprzedniej wiadomości weryfikacyjnej, tworzenie nowej...');
   }
 }
 
 // Tworzenie embeda weryfikacyjnego
 const verificationEmbed = new EmbedBuilder()
   .setTitle('Weryfikacja Steam')
   .setDescription('Aby uzyskać pełny dostęp do serwera, musisz zweryfikować swoje konto Steam. Kliknij przycisk poniżej, aby rozpocząć proces weryfikacji.')
   .setColor('#0099ff')
   .setTimestamp();
 
 // Tworzenie przycisku weryfikacji
 const verifyButton = new ButtonBuilder()
   .setCustomId('verify_button')
   .setLabel('Zweryfikuj')
   .setStyle(ButtonStyle.Primary);
 
 const row = new ActionRowBuilder().addComponents(verifyButton);
 
 if (verificationMessage) {
   // Aktualizacja istniejącej wiadomości
   await verificationMessage.edit({
     embeds: [verificationEmbed],
     components: [row]
   });
   return verificationMessage;
 } else {
   // Tworzenie nowej wiadomości weryfikacyjnej
   const newMessage = await verificationChannel.send({
     embeds: [verificationEmbed],
     components: [row]
   });
   
   // Zapisanie ID wiadomości w bazie danych
   await db.set('verificationMessageId', newMessage.id);
   return newMessage;
 }
} catch (error) {
 console.error('Błąd podczas tworzenia/aktualizacji wiadomości weryfikacyjnej:', error);
 return null;
}
}

/**
* Wysyła ping do nowego użytkownika na kanale weryfikacji, który znika po 3 sekundach
* @param {GuildMember} member - Nowy członek serwera Discord
*/
async function sendPingToNewMember(member) {
try {
 const verificationChannel = member.guild.channels.cache.get(config.verificationChannelId);
 
 if (!verificationChannel) {
   console.error('Kanał weryfikacji nie znaleziony!');
   return;
 }
 
 // Wysyłamy zwykłą wiadomość pingującą użytkownika
 const message = await verificationChannel.send({
   content: `**${member}**, witaj na serwerze! Sprawdź wiadomość weryfikacyjną powyżej i kliknij przycisk "Zweryfikuj", aby uzyskać pełen dostęp.`,
   allowedMentions: { users: [member.id] }
 });
 
 // Używamy standardowego setTimeout (a nie promisyfikowanej wersji)
 setTimeout(() => {
   message.delete().catch(error => {
     console.error('Nie udało się usunąć wiadomości powitalnej:', error);
   });
 }, 3000); // 3000 ms = 3 sekundy
} catch (error) {
 console.error('Błąd podczas wysyłania pinga do nowego członka:', error);
}
}

// Obsługa interakcji (przyciski, formularze modalne itp.)
client.on('interactionCreate', async (interaction) => {
try {
 // Obsługa kliknięcia przycisku weryfikacji
 if (interaction.isButton() && interaction.customId === 'verify_button') {
   await handleVerifyButtonClick(interaction);
 }
 
 // Obsługa przesłania formularza modalnego
 else if (interaction.isModalSubmit() && interaction.customId === 'steam_verification_modal') {
   await handleSteamVerificationModalSubmit(interaction);
 }
 
} catch (error) {
 console.error('Błąd w obsłudze interakcji:', error);
 
 // Informowanie użytkownika, że coś poszło nie tak
 if (interaction.isRepliable()) {
   await interaction.reply({
     content: 'Wystąpił błąd podczas przetwarzania twojej prośby. Spróbuj ponownie później.',
     flags: 64 // Użycie flagi zamiast ephemeral: true
   });
 }
}
});

/**
* Obsługuje kliknięcie przycisku weryfikacji
* @param {ButtonInteraction} interaction - Interakcja przycisku
*/
async function handleVerifyButtonClick(interaction) {
// Sprawdzenie, czy użytkownik jest już zweryfikowany
const user = await UserModel.getByDiscordId(interaction.user.id);

if (user && user.steamId) {
 return interaction.reply({
   content: 'Twoje konto jest już zweryfikowane!',
   flags: 64 // Użycie flagi zamiast ephemeral: true
 });
}

// Tworzenie formularza modalnego dla wprowadzania linku Steam
const modal = new ModalBuilder()
 .setCustomId('steam_verification_modal')
 .setTitle('Weryfikacja Steam');

// Dodawanie pola wprowadzania linku Steam
const steamLinkInput = new TextInputBuilder()
 .setCustomId('steam_link_input')
 .setLabel('Podaj link do swojego profilu Steam')
 .setPlaceholder('np. https://steamcommunity.com/id/example')
 .setStyle(TextInputStyle.Short)
 .setRequired(true);

// Dodanie pola do formularza modalnego
modal.addComponents(new ActionRowBuilder().addComponents(steamLinkInput));

// Pokazanie formularza modalnego użytkownikowi
await interaction.showModal(modal);
}

/**
* Obsługuje przesłanie formularza weryfikacji Steam
* @param {ModalSubmitInteraction} interaction - Interakcja przesłania formularza
*/
async function handleSteamVerificationModalSubmit(interaction) {
// Rozpocznij deferowanie odpowiedzi, ponieważ pobieranie danych z API Steam może chwilę potrwać
await interaction.deferReply({ flags: 64 }); // Użycie flagi zamiast ephemeral: true

try {
 // Pobranie linku Steam z formularza modalnego
 const steamLink = interaction.fields.getTextInputValue('steam_link_input');
 
 // Sprawdzenie poprawności linku Steam
 if (!SteamUtils.isValidSteamLink(steamLink)) {
   return interaction.editReply({
     content: 'Nieprawidłowy link do profilu Steam. Spróbuj ponownie z poprawnym linkiem lub identyfikatorem Steam.',
     flags: 64 // Użycie flagi zamiast ephemeral: true
   });
 }
 
 // Wyodrębnienie ID Steam z linku z konwersją na SteamID64
 const steamIdData = await SteamUtils.extractSteamId(steamLink);
 
 if (!steamIdData) {
   return interaction.editReply({
     content: 'Nie udało się przetworzyć linku do profilu Steam. Upewnij się, że podany profil istnieje i jest publiczny.',
     flags: 64 // Użycie flagi zamiast ephemeral: true
   });
 }
 
 console.log('Dane Steam:', JSON.stringify(steamIdData, null, 2));
 
 // Zapisanie ID Steam użytkownika w bazie danych
 // Zawsze zapisujemy SteamID64, jeśli udało się go uzyskać
 const steamData = {
   id: steamIdData.id,
   type: steamIdData.type,
   originalInput: steamIdData.originalInput
 };
 
 // Jeśli mamy dodatkowe informacje o profilu, zapisujemy również nazwę użytkownika
 if (steamIdData.profileInfo) {
   steamData.personaname = steamIdData.profileInfo.personaname;
   steamData.profileurl = steamIdData.profileInfo.profileurl;
   steamData.avatar = steamIdData.profileInfo.avatar;
 }
 
 // Jeśli występuje vanity URL, zapisujemy go również
 if (steamIdData.vanityUrl) {
   steamData.vanityUrl = steamIdData.vanityUrl;
 }
 
 await UserModel.updateSteamId(interaction.user.id, steamData);
 
 // Pobieranie obiektu członka serwera
 const guild = interaction.guild;
 const member = guild.members.cache.get(interaction.user.id);
 
 if (member) {
   // Nadawanie roli zweryfikowanego użytkownika
   await member.roles.add(config.verifiedRoleId);
   
   // Usuwanie roli niezweryfikowanego użytkownika
   await member.roles.remove(config.autoRoleId);
   
   console.log(`Użytkownik ${member.user.tag} został zweryfikowany - dodano rolę zweryfikowanego i usunięto rolę niezweryfikowanego`);
 }
 
 // Przygotowanie informacji dla użytkownika
 let successMessage = 'Twoje konto zostało pomyślnie zweryfikowane! Przyznano Ci rolę zweryfikowanego użytkownika.';
 
 // Jeśli mamy informacje o profilu, pokażmy nazwę profilu
 if (steamIdData.profileInfo) {
   successMessage += `\n\nPowiązano z kontem Steam: **${steamIdData.profileInfo.personaname}**`;
 }
 
 // Wiadomość potwierdzająca
 return interaction.editReply({
   content: successMessage,
   flags: 64 // Użycie flagi zamiast ephemeral: true
 });
} catch (error) {
 console.error('Błąd podczas procesu weryfikacji:', error);
 return interaction.editReply({
   content: 'Wystąpił błąd podczas weryfikacji. Prosimy spróbować ponownie później.',
   flags: 64 // Użycie flagi zamiast ephemeral: true
 });
}
}

// Obsługa wiadomości - do komend administracyjnych
client.on('messageCreate', async (message) => {
// Ignorowanie wiadomości od botów
if (message.author.bot) return;

// Sprawdzenie, czy wiadomość zaczyna się od prefiksu
if (!message.content.startsWith(config.prefix)) return;

// Wyodrębnienie nazwy komendy i argumentów
const args = message.content.slice(config.prefix.length).trim().split(/ +/);
const commandName = args.shift().toLowerCase();

// Obsługa komendy do wyświetlania bazy danych
if (commandName === 'baza') {
 await handleDatabaseCommand(message, args);
}
});

/**
* Obsługuje komendę do wyświetlania bazy danych
* @param {Message} message - Obiekt wiadomości Discord
* @param {Array} args - Argumenty komendy
*/
async function handleDatabaseCommand(message, args) {
try {
 // Sprawdzenie uprawnień - tylko administratorzy mogą używać tej komendy
 const member = message.member;
 if (!member.roles.cache.has(config.adminRoleId)) {
   return message.reply('Nie masz uprawnień do użycia tej komendy.');
 }
 
 // Sprawdzamy, jakiego typu dane chce użytkownik
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
   
   // Dzielimy odpowiedź, jeśli jest zbyt długa
   if (userInfo.length > 1900) {
     // Podziel na wiele wiadomości, jeśli odpowiedź jest zbyt długa
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
   
   // Wyświetlamy maksymalnie 25 dinozaurów (limit pól dla embeda Discord)
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
 
 // Jeśli podano nieprawidłowy argument
 await message.reply('Nieprawidłowa komenda bazy danych. Użyj `!baza help` aby zobaczyć dostępne opcje.');
 
} catch (error) {
 console.error('Błąd podczas obsługi komendy bazy danych:', error);
 await message.reply('Wystąpił błąd podczas przetwarzania komendy. Spróbuj ponownie później.');
}
}

// Uruchomienie bota
client.login(config.token);