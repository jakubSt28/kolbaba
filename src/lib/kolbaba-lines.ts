import { tk } from "./i18n";

/**
 * What Kolbaba writes on the back of his postcard. Our own lines, in his voice: a postman who has
 * just delivered everything, friendly and now and then a bit cheeky. English keys, Czech in
 * src/lib/i18n/cs/app.ts. One a day (src/lib/postcard.ts picks it).
 */
export const POSTCARD_LINES = [
  tk("All delivered. My bag is so light I nearly floated off."),
  tk("Not a single letter left. I checked twice, and under the seat."),
  tk("Empty bag, light shoulders. I'm off for a coffee. Have one too."),
  tk("The dog at number 12 still doesn't like me. Everything else went fine."),
  tk("Done for now. If anything important comes, I'll bring it straight away."),
  tk("I sort, you decide. Good teamwork."),
  tk("Nothing waiting. Go outside, it's lovely here."),
  tk("Your inbox is so empty it echoes."),
  tk("A postman's favourite view: the bottom of the bag."),
  tk("I've hung my cap on the nail for a minute. Don't tell anyone."),
  tk("Everything's where it belongs. Even the newsletters, mostly."),
  tk("Quiet round today. I counted three cows and no unread mail."),
  tk("If letters weighed anything, my back would thank you today."),
  tk("Inbox zero. Somewhere a postman is smiling. (It's me.)"),
  tk("Greetings from the road. The mustache is fine, thanks for asking."),
  tk("All caught up. That's rarer than a letter with a real stamp."),
  tk("The goblins at the post office say hello."),
  tk("Even the longest round ends at an empty bag."),
  tk("Nothing left to sort, so I'm sorting my thoughts."),
  tk("A postcard is the only mail nobody has to answer. Enjoy it."),
  tk("Today's weather: clear skies, zero letters."),
] as const;

export const NIGHT_LINE = tk("It's late. I'm off to bed, and you should go too.");
export const MORNING_LINE = tk("Morning round done before the coffee got cold.");
export const PADLA_LINE = tk("Padla! That's what we say when the shift is over. Off you go.");
