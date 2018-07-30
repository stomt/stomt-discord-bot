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
	MESSAGE_REACTION_ADD: 'addReaction',
	MESSAGE_REACTION_REMOVE: 'removeReaction',
	MESSAGE_CREATE: 'handleMessageCreation',
	CHANNEL_UPDATE: 'handleChannelUpdate',
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

const prefix = config.environment === 'production' ? '' : config.environment;
const wish_commands = [prefix + '!iwish', prefix +  '.iwish', prefix +  'iwish', prefix +  '!wish', prefix +  '.wish'];
const like_commands = [prefix + '!ilike', prefix +  '.ilike', prefix +  'ilike', prefix +  '!like', prefix +  '.like'];

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
	    .then(json => {
	    	if (!json.data || json.error) {
	    		console.log('Request failed:', json.error);
	    		console.log(' > POST', url);
	    		console.log(' > data:', data);
	    		console.log(' > response:', json);
	    	}
	    	return json;
	    })
	    .catch(err => console.error(err));
}


/// EVENTS ///

/**
 * Choose which Discord events will be handeled further
 * and extend the results.
 */
client.on('raw', async event => {
	// reaction events
	if (event.t === 'MESSAGE_REACTION_ADD' || event.t === 'MESSAGE_REACTION_REMOVE') {
		const { d: data } = event;
		const user = client.users.get(data.user_id);
		const channel = client.channels.get(data.channel_id) || await user.createDM();

		const message = await channel.fetchMessage(data.message_id);
		const emojiKey = (data.emoji.id) ? `${data.emoji.name}:${data.emoji.id}` : data.emoji.name;
		let reaction = message.reactions.get(emojiKey);

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

		if (!message.author.bot) {
			client.emit('messageCommand', message, user);
		}
	}


	// connected to new guild
	if (event.t === 'GUILD_CREATE') {
		const { d: data } = event;
		const guild = await client.guilds.get(data.id);

		if (!guild) {
			console.log('Can\'t load guild:', data);
			return;
		}

		console.log('CONNECTED TO GUILD');
		console.log(' > name:   ', guild.name);
		console.log(' > id:     ', guild.id);
		console.log(' > members:', guild.memberCount);

		guild.channels.forEach(channel => {
			if (channel.type === 'text') {
				client.emit(events['CHANNEL_UPDATE'], channel);
			}
		});
	}

	// access to channel changed
	if (event.t === 'CHANNEL_UPDATE') {
		const { d: data } = event;
		const channel = await client.channels.get(data.id);
		if (channel.type === 'text') {
			client.emit(events['CHANNEL_UPDATE'], channel);
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
client.on(events.MESSAGE_REACTION_ADD, (reaction, user) => {
	const stomtLink = getStomtLink(reaction.message);
	if (!stomtLink || !shouldReactionBeHandeled(reaction, user)) {
		return;
	}

	removeOtherReaction(reaction, user);
	addReactionOnSTOMT(reaction, user, stomtLink);
});

function removeOtherReaction(reaction, user) {
	let votes = null;
	if (reaction.emoji.name === upvote_emoji) {
		votes = reaction.message.reactions.get(downvote_emoji);
	} else {
		votes = reaction.message.reactions.get(upvote_emoji);
	}

	if (!votes) {
		return;
	}

	// We could fetch the users first to check if the current user gave the
	// other reaction aswell. But trying to remove it is also only one request.
	//const users = await votes.fetchUsers();
	//users.has(user.id);

	votes.remove(user).catch(err => {
		if (err.code === 50013) { // Missing Permissions
			console.warn(
				  '[MANAGE_MESSAGES] No permissions to remove reactions in \n'
				+ ' > guild: ' + reaction.message.channel.guild.name + " (" + reaction.message.channel.guild.id + ")\n"
				+ ' > channel: ' + reaction.message.channel.name + " (" + reaction.message.channel.id + ")\n"
			);
		} else {
			console.error(err);
		}
	});
}

function addReactionOnSTOMT(reaction, user, stomtLink) {
	const url = config.api_endpoint + '/addVote'
	const data = {
		message_id: reaction.message.id,
		channel_id: reaction.message.channel.id,
		guild_id: reaction.message.channel.guild.id,
		user_id: user.id,
		stomt_link: stomtLink,
		positive: reaction.emoji.name === upvote_emoji
	};

	sendApiRequestPost(url, data);
}

/**
 * Handle all removed reactions and send valid ones to the
 * STOMT servers.
 */
client.on(events.MESSAGE_REACTION_REMOVE, (reaction, user) => {
	const stomtLink = getStomtLink(reaction.message);
	if (!stomtLink || !shouldReactionBeHandeled(reaction, user)) {
		return;
	}

	removeReactionOnSTOMT(reaction, user, stomtLink);
});

function removeReactionOnSTOMT(reaction, user, stomtLink) {
	const url = config.api_endpoint + '/removeVote'
	const data = {
		message_id: reaction.message.id,
		channel_id: reaction.message.channel.id,
		guild_id: reaction.message.channel.guild.id,
		user_id: user.id,
		stomt_link: stomtLink,
		positive: reaction.emoji.name === upvote_emoji
	};

	sendApiRequestPost(url, data);
}

/**
 * Let bot add reactions on every posted Stomt link, so users
 * just have to click on the reaction.
 */
client.on(events.MESSAGE_CREATE, async (message, user) => {
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
 * Allow to create a Stomt from discord.
 */
client.on('messageCommand', async (message, user) => {
	const args = message.content.split(/ +/);
	const command = args.shift().toLowerCase();

	// check command
	if (!wish_commands.includes(command) && !like_commands.includes(command)) return;
	const positive = like_commands.includes(command);

	// check args
	if (args.length < 2) {
		if (positive) {
			return message.channel.send(`Please specify who you want to address and write your like \`Ilike stomt because of this!\`, ${message.author}!`);
		} else {
			return message.channel.send(`Please specify who you want to address and write your wish \`IWish stomt would save this!\`, ${message.author}!`);
		}
	}

	// submit
	const target_id = args[0];
	const text = args.slice(1).join(' ').substring(0, 120);
	const url = config.api_endpoint + '/addStomt'
	const data = {
		message_id: message.id,
		channel_id: message.channel.id,
		guild_id: message.channel.guild.id,
		user_id: user.id,

		target_id: target_id,
		text: text,
		positive: false
	};
	const response = await sendApiRequestPost(url, data);

	// answer
	if (!response || !response.data || response.error) {
		if (response.error === 'You already posted this stomt.') {
			return message.channel.send(`You already posted this Stomt.`);
		} else {
			if (positive) {
				return message.channel.send(`I was unable to find  \`${target_id}\` on STOMT, please specify who you want to address and write your like \`Ilike stomt-discord a lot!!!\`, ${message.author}!`);
			} else {
				return message.channel.send(`I was unable to find  \`${target_id}\` on STOMT, please specify who you want to address and write your wish \`Iwish stomt-discord would post my wish.\`, ${message.author}!`);
			}
		}
	}

	const embed = new Discord.RichEmbed(response.data.embed.embeds[0]);
	message.channel.send(`Thanks ${message.author}, I saved your Stomt to the feedback directory, lets share and vote it.`, {embed});
});

/**
 * Check last messages of channel for Stomt links.
 */
client.on(events.CHANNEL_UPDATE, (channel) => {
	channel.fetchMessages({ limit: 20 })
		.then(messages => {
			messages.forEach(message => {
				client.emit(events['MESSAGE_CREATE'], message, message.author);
			});
		})
		.catch(err => {
			if (err.code === 50001) {
				console.warn(
					  '[Missing Access] Failed to read messages in \n'
					+ ' > guild: ' + channel.guild.name + " (" + channel.guild.id + ")\n"
					+ ' > channel: ' + channel.name + " (" + channel.id + ")\n"
				);
			} else {
				console.error('[Missing Access] Failed to read messages', err)
			}
		});
});

/**
 * Connect to all authorized Discord Guilds
 */
client.login(config.token);
