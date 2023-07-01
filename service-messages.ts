import { parse as parseYAML } from "yaml";
import { getState, writeState } from "./utils/state";
import { DiscordMessage, discordFetch } from "./utils/discord";
import { sleep } from "bun";
import { glob } from "glob";
import { serviceMessageChannel, serviceMessagesState } from "./utils/config";

const stateChannelID = process.env.STATE_CHANNEL_ID;
if (!stateChannelID) {
  throw new Error("STATE_CHANNEL_ID is not set");
}

type State = {
  [messageFile: string]: { channel: string; messages: string[] };
};

type ServiceMessage = { text: string; pin?: boolean };

type ServiceMessageFile = {
  channelID: string;
  messages: ServiceMessage[];
};

let state = await getState<State>(serviceMessagesState);

// Setup defaults...
state = {
  ...state,
};

const messageFiles = process.argv[2]
  ? [process.argv[2]]
  : await glob("service-messages/**/*.yaml");

try {
  for (const messageFile of messageFiles) {
    const key =
      messageFile.split("/").pop()?.replace(".yaml", "") || messageFile;
    const file = Bun.file(messageFile);
    const fileContents = await file.text();
    const data: ServiceMessageFile = parseYAML(fileContents);

    data.channelID = serviceMessageChannel(data.channelID);

    console.info(`=== PROCESSING ${messageFile} ===`);

    state[key] = state[key] || { channel: data.channelID, messages: [] };

    if (state[key].channel !== data.channelID) {
      console.info(`=> CHANNEL CHANGED, RESETTING STATE`);
      console.info(
        "I don't clean up old messages, so you'll have to do that manually."
      );
      state[key] = { channel: data.channelID, messages: [] };
    }

    let knownMessageIDs = state[key].messages;

    for (const [idx, message] of data.messages.entries()) {
      await sleep(2000);

      if (knownMessageIDs[idx]) {
        const messageID = knownMessageIDs[idx];
        // Pull current message
        const response: DiscordMessage = await discordFetch(
          `/channels/${data.channelID}/messages/${messageID}`
        );

        if (response.content === message.text) {
          console.info(`=> MESSAGE ${idx + 1} UNCHANGED, SKIPPING`);
          continue;
        }

        console.info(`=> UPDATING MESSAGE ${idx + 1}`);
        await discordFetch(
          `/channels/${data.channelID}/messages/${messageID}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              content: message.text,
            }),
          }
        );
        continue;
      }

      console.info(`=> SENDING MESSAGE ${idx + 1}`);
      const response: DiscordMessage = await discordFetch(
        `/channels/${data.channelID}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            content: message.text,
          }),
        }
      );

      knownMessageIDs[idx] = response.id;
    }
  }
} finally {
  await writeState(serviceMessagesState, state);
}
