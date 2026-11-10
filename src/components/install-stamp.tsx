"use client";

import { useEffect } from "react";
import { noteInstall } from "@/lib/install";

/** Which version the Home Screen icon was added with (src/lib/install.ts), noted on whatever page it opens. */
export function InstallStamp() {
  useEffect(() => noteInstall(), []);
  return null;
}
