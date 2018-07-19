const Discord = require('discord.js');
const config = require('./config.json');
const client = new Discord.Client();

client.on('ready', () => {
	console.log('Ready!');
});

const events = {
	MESSAGE_REACTION_ADD: 'messageReactionAdd',
	MESSAGE_REACTION_REMOVE: 'messageReactionRemove',
};

client.on('raw', async event => {
	if (!events.hasOwnProperty(event.t)) return;

	const { d: data } = event;
	const user = client.users.get(data.user_id);
	const channel = client.channels.get(data.channel_id) || await user.createDM();

	if (channel.messages.has(data.message_id)) return;

	const message = await channel.fetchMessage(data.message_id);
	const emojiKey = (data.emoji.id) ? `${data.emoji.name}:${data.emoji.id}` : data.emoji.name;
	let reaction = message.reactions.get(emojiKey);

	if (!reaction) {
		const emoji = new Discord.Emoji(client.guilds.get(data.guild_id), data.emoji);
		reaction = new Discord.MessageReaction(message, emoji, 1, data.user_id === client.user.id);
	}

	client.emit(events[event.t], reaction, user, channel, message);
});

client.on('messageReactionAdd', (reaction, user, channel, message) => {
	//console.log(message.reactions.first().users); // is empty
	console.log(`${user.username} reacted with "${reaction.emoji.name}" in #${channel.name}.`);
});

client.on('messageReactionRemove', (reaction, user, channel, message) => {
	console.log(`${user.username} removed their "${reaction.emoji.name}" reaction.`);
});

client.login(config.token);
