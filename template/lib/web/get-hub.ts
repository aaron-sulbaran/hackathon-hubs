import "server-only";
import { cache } from "react";
import { loadHub } from "./hub";

/** One load per request, shared by the layout and the page. */
export const getHub = cache(loadHub);
