const Discord = require('discord.js');
const fetch = require('node-fetch');
const client = new Discord.Client();
var configFile = {};
try {
    configFile = require('./config.json');
} catch (ex) {
    // process.env may be available
}

/// CONSTANTS ///

const events = {
	MESSAGE_REACTION_ADD: 'messageReactionAdd',
	MESSAGE_REACTION_REMOVE: 'messageReactionRemove',
	MESSAGE_CREATE: 'messageCreate',
};

const emojis = {
	thumbsup: "👍",
	thumbsdown: "👎",
	heart: "❤",
	heavy_multiplication_x: "✖",
	x: "❌"
};

const urlRegexesEnvironments = {
	production: [
		/(https?:\/\/www.stomt.com\/.+\/[^\s]+)/g, // Stomt links (e.g. https://www.stomt.com/stomt/teamwork-webhook)
		/(https?:\/\/stomt.co\/[^\s]+)/g, // Short Stomt links (e.g. https://stomt.co/gtKug)
	],
	staging: [
		/(https?:\/\/test.stomt.com\/.+\/[^\s]+)/g,
		/(https?:\/\/test.stomt.co\/[^\s]+)/g,
	],
	local: [
		/(https?:\/\/stomt.web\/.+\/[^\s]+)/g,
		/(https?:\/\/stomt.short\/[^\s]+)/g,
	]
};


/// CONFIG ///

const config = {
	token: process.env.DISCORD_APP_TOKEN || configFile.discord_app_token,
    api_endpoint: process.env.STOMT_API_ENDPOINT || configFile.stomt_api_endpoint,
    app_id: process.env.STOMT_APP_ID || configFile.stomt_app_id,
    environment: process.env.ENVIRONMENT || configFile.environment,
};
const upvote_emoji = emojis.heart;
const downvote_emoji = emojis.heavy_multiplication_x;
const urlRegexes = urlRegexesEnvironments[config.environment];

/// HELPER FUNCTIONS ///

function getStomtLink(message) {
	var texts = [];
	if (message && message.embeds && message.embeds.length > 0 && message.embeds[0].url) {
		texts.push(message.embeds[0].url);
	}

	if (message && message.content) {
		texts.push(message.content);
	}

	return extractLink(texts);
}

function extractLink(texts) {
	for (var i in texts) {
		for (var j in urlRegexes) {
			const results = texts[i].match(urlRegexes[j]);
			if (results && results.length > 0) {
				return results[0];
			}
		}
	}
}

function shouldReactionBeHandeled(reaction, user) {
	// Is by bot?
	if (user.bot) {
		return false;
	}

	// Is allowed reaction?
	if (reaction.emoji.name !== upvote_emoji && reaction.emoji.name !== downvote_emoji) {
		return false;
	}

	return true;
}

function sendApiRequestPost(url, data) {
	console.log('POST', url);
	console.log('data:', data);

	const options = {
	    method: 'POST',
	    body:    JSON.stringify(data),
	    headers: {
	    	'Content-Type': 'application/json',
	    	'AppId': config.app_id,
	    },
	};

	return fetch(url, options)
	    .then(res => res.json())
	    .catch(err => console.error(err));
}


/// EVENTS ///

/**
 * Choose which Discord events will be handeled further
 * and extend the results.
 */
client.on('raw', async event => {
	// reaction events
	if (event.t === 'MESSAGE_REACTION_ADD' || events.t === 'MESSAGE_REACTION_REMOVE') {
		const { d: data } = event;
		const user = client.users.get(data.user_id);
		const channel = client.channels.get(data.channel_id) || await user.createDM();

		if (channel.messages.has(data.message_id)) return;

		const message = await channel.fetchMessage(data.message_id);
		const emojiKey = (data.emoji.id) ? `${data.emoji.name}:${data.emoji.id}` : data.emoji.name;
		let reaction = message.reactions.get(emojiKey);

		// Can be used to validate all votes
		//const users = await reaction.fetchUsers();

		if (!reaction) {
			const emoji = new Discord.Emoji(client.guilds.get(data.guild_id), data.emoji);
			reaction = new Discord.MessageReaction(message, emoji, 1, data.user_id === client.user.id);
		}

		client.emit(events[event.t], reaction, user);
	}

	// message events
	if (event.t === 'MESSAGE_CREATE') {
		const { d: data } = event;
		const user = client.users.get(data.author.id);
		const channel = client.channels.get(data.channel_id) || await user.createDM();

		if (channel.messages.has(data.id)) return;

		const message = await channel.fetchMessage(data.id);

		client.emit(events[event.t], message, user);
	}


	// connected to new guild
	if (event.t === 'GUILD_CREATE') {
		const { d: data } = event;
		const guild = await client.guilds.get(data.id);

		console.log('CONNECTED TO GUILD');
		console.log('name:   ', guild.name);
		console.log('id:     ', guild.id);
		console.log('members:', guild.memberCount);

		guild.channels.forEach(channel => {
			if (channel.type === 'text') {
				channel.fetchMessages({ limit: 20 })
					.then(messages => {
						messages.forEach(message => {
							client.emit(events['MESSAGE_CREATE'], message, message.author);
						});
					})
					.catch(err => console.error('Failed to read messages', err));
			}
		});
	}

	// access to channel changed
	if (event.t === 'CHANNEL_UPDATE') {
		const { d: data } = event;
		const channel = await client.channels.get(data.id);
		if (channel.type === 'text') {
			channel.fetchMessages({ limit: 20 })
				.then(messages => {
					messages.forEach(message => {
						client.emit(events['MESSAGE_CREATE'], message, message.author);
					});
				})
				.catch(err => console.error('Failed to read messages', err));
		}
	}

	// ready event
	if (event.t === 'READY') {
		console.log('Ready!');
	}
});

/**
 * Handle all added reactions and send valid ones to the
 * STOMT servers.
 */
client.on('messageReactionAdd', (reaction, user) => {
	const stomtLink = getStomtLink(reaction.message);
	if (!stomtLink || !shouldReactionBeHandeled(reaction, user)) {
		return;
	}

	const url = config.api_endpoint + '/addVote'
	const data = {
		message_id: reaction.message.id,
		channel_id: reaction.message.channel.id,
		guild_id: reaction.message.channel.guild.id,
		user_id: user.id,
		stomt_link: stomtLink,
		positive: reaction.emoji.name === upvote_emoji
	};

	sendApiRequestPost(url, data)
		.then(json => console.log(json));
});

/**
 * Handle all removed reactions and send valid ones to the
 * STOMT servers.
 */
client.on('messageReactionRemove', (reaction, user) => {
	const stomtLink = getStomtLink(reaction.message);
	if (!stomtLink || !shouldReactionBeHandeled(reaction, user)) {
		return;
	}

	const url = config.api_endpoint + '/removeVote'
	const data = {
		message_id: reaction.message.id,
		channel_id: reaction.message.channel.id,
		guild_id: reaction.message.channel.guild.id,
		user_id: user.id,
		stomt_link: stomtLink,
		positive: reaction.emoji.name === upvote_emoji
	};

	sendApiRequestPost(url, data)
		.then(json => console.log(json));
});

/**
 * Let bot add reactions on every posted Stomt link, so users
 * just have to click on the reaction.
 */
client.on('messageCreate', async (message, user) => {
	const stomtLink = getStomtLink(message);
	if (!stomtLink) {
		return;
	}

	// validate link
	const url = config.api_endpoint + '/validateLink'
	const data = {
		stomt_link: stomtLink
	};

	const resonse = await sendApiRequestPost(url, data);
	if (resonse.error) {
		return; // No Stomt found for this link
	}

	message
		.react(upvote_emoji)
		.then(() => message.react(downvote_emoji));
	});

/**
 * Connect to all authorized Discord Guilds
 */
client.login(config.token);
