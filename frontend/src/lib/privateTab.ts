import type { ComponentType, ReactNode } from "react";

import type { AppDict } from "@/lib/types";

/**
 * Contract between `App.tsx` and the optional private-only source tab.
 *
 * The interface is shared; only the implementation under `src/private/` is
 * optional. `App.tsx` discovers that implementation with a glob, so when the
 * directory is absent the glob is empty, no tab renders, and nothing needs
 * editing. Keeping the interface here rather than in `private/` is what makes
 * the removal edit-free.
 */

/** Everything a source tab needs from the app shell. */
export interface PrivateTabContext {
    dict: AppDict;
    powerMode: boolean;
    onExtracted: (title: string, tags: string[], artist: string) => void;
    onBridgeToDownloads: (path: string, filename: string) => void;
}

/** A Help sheet entry contributed by a private tab, so the help rail stays in
 *  step with the tabs that actually exist. */
export interface PrivateHelpTopic {
    id: string;
    label: string;
    icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
    render: () => ReactNode;
}

export interface PrivateTab {
    /** Tabs value; must not collide with a built-in mode. */
    id: string;
    label: string;
    helpTopic?: PrivateHelpTopic;
    /** True when a URL param means the app should open on this tab instead of
     *  the default. Read at mount, in a lazy initialiser. */
    shouldAutoSelect?: () => boolean;
    /** Called once after mount to strip params this tab has consumed, so a
     *  refresh doesn't re-apply them. URL-bar only, never setState. */
    consumeUrlParams?: () => void;
    render: (ctx: PrivateTabContext) => ReactNode;
}
