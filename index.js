const Discord = require('discord.js');
const config = require('./config.json');
const fetch = require('node-fetch');
const client = new Discord.Client();

client.on('ready', () => {
	console.log('Ready!');
});

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
const upvote_emoji = emojis.heart;
const downvote_emoji = emojis.heavy_multiplication_x;

function getStomtLink(message) {
	if (message && message.embeds && message.embeds.length > 0 && message.embeds[0].url) {
		if (isStomtLink(message.embeds[0].url)) {
			return message.embeds[0].url;
		}
	}

	if (message && message.content) {
		const urlRegex = new RegExp('(http|https)://([\w_-]+(?:(?:\.[\w_-]+)+))([\w.,@?^=%&:/~+#-]*[\w@?^=%&/~+#-])?');
		const results = message.content.match(urlRegex);
		if (results && results.length > 0) {
			if (isStomtLink(results.length[0])) {
				return results.length[0];
			}
		}
	}

	return false;
}

function isStomtLink(url) {
	if (url.startsWith('http://stomt.co')) {
		return true;
	}
	if (url.startsWith('https://stomt.co')) {
		return true;
	}
	if (url.startsWith('http://stomt.com')) {
		return true;
	}
	if (url.startsWith('https://stomt.com')) {
		return true;
	}
	if (url.startsWith('http://www.stomt.com')) {
		return true;
	}
	if (url.startsWith('https://www.stomt.com')) {
		return true;
	}
	return false;
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
	    .then(res => res.json());
}

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

});

client.on('messageReactionAdd', (reaction, user) => {

	// Is by bot?
	if (user.bot) {
		return;
	}

	// Is on Stomt link?
	const stomtLink = getStomtLink(reaction.message);
	if (!stomtLink) {
		return;
	}

	// Is allowed reaction?
	if (reaction.emoji.name !== upvote_emoji && reaction.emoji.name !== downvote_emoji) {
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

client.on('messageReactionRemove', (reaction, user) => {
	// Is by bot?
	if (user.bot) {
		return;
	}

	// Is on Stomt link?
	const stomtLink = getStomtLink(reaction.message);
	if (!stomtLink) {
		return;
	}

	// Is allowed reaction?
	if (reaction.emoji.name !== upvote_emoji && reaction.emoji.name !== downvote_emoji) {
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

client.on('messageCreate', (message, user) => {
	const stomtLink = getStomtLink(message);
	if (!stomtLink) {
		return;
	}

	message
		.react(upvote_emoji)
		.then(() => message.react(downvote_emoji));
})

client.login(config.token);
