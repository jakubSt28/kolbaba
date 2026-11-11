import type { Dictionary } from "..";
import { accounts } from "./accounts";
import { admin } from "./admin";
import { app } from "./app";
import { auth } from "./auth";
import { calendar } from "./calendar";
import { categories } from "./categories";
import { compose } from "./compose";
import { contacts } from "./contacts";
import { folders } from "./folders";
import { history } from "./history";
import { kolbaba } from "./kolbaba";
import { lists } from "./lists";
import { news } from "./news";
import { quiet } from "./quiet";
import { safety } from "./safety";
import { reader } from "./reader";
import { server } from "./server";
import { triage } from "./triage";

/** Czech, split by area of the app so it stays easy to find (the keys are the English texts). */
export const CS: Dictionary = {
  ...app,
  ...accounts,
  ...admin,
  ...auth,
  ...calendar,
  ...categories,
  ...compose,
  ...contacts,
  ...folders,
  ...history,
  ...kolbaba,
  ...lists,
  ...news,
  ...quiet,
  ...safety,
  ...reader,
  ...server,
  ...triage,
};
