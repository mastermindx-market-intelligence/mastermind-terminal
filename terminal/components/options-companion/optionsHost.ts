import { createContext, useContext } from "react";

/** Where the shared Options companion is mounted. "rail" sits beside a chart (desktop rail or
 *  phone sheet): it can pin a level to that chart and links out to the full desk. "page" is the
 *  /options Exposure desk itself: there is no chart to pin to, and a link to the desk would point
 *  at the page the reader is already on. */
export type OptionsHost = "rail" | "page";
export const OptionsHostContext = createContext<OptionsHost>("rail");
export function useOptionsHost(): OptionsHost { return useContext(OptionsHostContext); }
