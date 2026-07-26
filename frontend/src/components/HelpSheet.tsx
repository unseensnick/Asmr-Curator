import { type ComponentType, useState } from "react";
import {
    BookOpen,
    Cloud,
    Cookie,
    FileAudio,
    FileText,
    FolderOpen,
    Globe,
    Keyboard,
    Layers,
    MousePointerClick,
    Network,
    PenLine,
    Sparkles,
} from "lucide-react";

import { HelpCard, TopicHeader } from "@/components/HelpPrimitives";
import SheetHeaderBar from "@/components/SheetHeaderBar";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { PrivateHelpTopic } from "@/lib/privateTab";

interface HelpSheetProps {
    open: boolean;
    onClose: () => void;
    /** Topics contributed by optional private-only tabs. Empty when none are
     *  registered, and the rail simply has one fewer entry. */
    extraTopics?: readonly PrivateHelpTopic[];
}

/**
 * Right-side reference sheet. Not a tutorial — no forced walkthrough,
 * no modal-on-load, no step-by-step overlay. The user opens this to
 * answer "what does this do" or "how does that work"; otherwise the
 * app stays quiet.
 *
 * Layout matches the LibraryExplorerSheet shape: left rail of topics,
 * right content panel that swaps based on the active topic. The split
 * keeps the page short — the previous single-scroll sheet had grown
 * past ten screens as features landed and users had to scroll past
 * sections they didn't care about to reach the one they did.
 *
 * Topics are intentionally a flat list, not a tree. A sub-menu would
 * be over-organisation at this size; the rail already fits.
 */
type BuiltInTopicId =
    | "overview"
    | "setup"
    | "patreon"
    | "drive"
    | "screenshot"
    | "library"
    | "bulk"
    | "dictionary"
    | "shortcuts"
    | "selfhost";

/** Built-in ids plus whatever a private tab registers. */
type TopicId = BuiltInTopicId | (string & {});

interface Topic {
    id: TopicId;
    label: string;
    icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}

const TOPICS: readonly Topic[] = [
    { id: "overview", label: "Overview", icon: Sparkles },
    { id: "setup", label: "Getting started", icon: Cookie },
    { id: "patreon", label: "Patreon URL", icon: Globe },
    { id: "drive", label: "Google Drive", icon: Cloud },
    { id: "screenshot", label: "Screenshot", icon: FileText },
    { id: "library", label: "File library", icon: FolderOpen },
    { id: "bulk", label: "Bulk edit", icon: Layers },
    { id: "dictionary", label: "Tag dictionary", icon: BookOpen },
    { id: "shortcuts", label: "Shortcuts and tips", icon: Keyboard },
    { id: "selfhost", label: "Self-hosting", icon: Network },
];

export default function HelpSheet({ open, onClose, extraTopics = [] }: HelpSheetProps) {
    // Topic resets to overview on every open. State doesn't survive
    // close + reopen because the sheet is unmounted while closed (and
    // the next visit usually wants the canonical entry point anyway).
    const [topic, setTopic] = useState<TopicId>("overview");

    return (
        <Sheet
            open={open}
            onOpenChange={(v) => {
                if (!v) {
                    setTopic("overview");
                    onClose();
                }
            }}
        >
            <SheetContent
                className="w-full sm:max-w-2xl lg:max-w-4xl xl:max-w-5xl overflow-hidden"
                showCloseButton={false}
            >
                <SheetTitle className="sr-only">Help and reference</SheetTitle>
                <SheetDescription className="sr-only">
                    Documentation for every feature in this project, organised by topic.
                </SheetDescription>

                <SheetHeaderBar
                    title="Help and reference"
                    closeLabel="Close help"
                    onClose={onClose}
                />

                {/* Body: rail + content. min-h-0 on the parent lets the
                    scrollable main column overflow-y inside the sheet
                    instead of pushing the sheet itself off-screen. */}
                <div className="flex flex-1 min-h-0">
                    <aside
                        className="flex flex-col gap-1 w-52 shrink-0 px-3 py-3 border-r border-border bg-muted/15 overflow-y-auto"
                        aria-label="Help topics"
                    >
                        {[...TOPICS, ...extraTopics].map((t) => (
                            <TopicButton
                                key={t.id}
                                icon={t.icon}
                                label={t.label}
                                active={topic === t.id}
                                onClick={() => setTopic(t.id)}
                            />
                        ))}
                    </aside>

                    <main
                        className="flex-1 min-w-0 overflow-y-auto px-6 py-6"
                        aria-live="polite"
                        aria-atomic="true"
                    >
                        <TopicContent topic={topic} extraTopics={extraTopics} />
                    </main>
                </div>
            </SheetContent>
        </Sheet>
    );
}

function TopicButton({
    icon: Icon,
    label,
    active,
    onClick,
}: {
    icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 " +
                (active
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30 ring-inset"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground")
            }
        >
            <Icon size={16} aria-hidden />
            <span>{label}</span>
        </button>
    );
}

// ── Topic content ────────────────────────────────────────────────────────────
//
// Each topic gets its own render block. Static prose grouped into the
// existing `HelpCard` pattern where structure helps; plain paragraphs
// otherwise. Update in place when the workflow shifts — none of this
// is generated.

function TopicContent({
    topic,
    extraTopics,
}: {
    topic: TopicId;
    extraTopics: readonly PrivateHelpTopic[];
}) {
    // A registered private topic renders itself; the switch only knows built-ins.
    const extra = extraTopics.find((t) => t.id === topic);
    if (extra) return <>{extra.render()}</>;

    switch (topic) {
        case "overview":
            return <OverviewTopic />;
        case "setup":
            return <SetupTopic />;
        case "patreon":
            return <PatreonTopic />;
        case "drive":
            return <DriveTopic />;
        case "screenshot":
            return <ScreenshotTopic />;
        case "library":
            return <LibraryTopic />;
        case "bulk":
            return <BulkTopic />;
        case "dictionary":
            return <DictionaryTopic />;
        case "shortcuts":
            return <ShortcutsTopic />;
        case "selfhost":
            return <SelfhostTopic />;
    }
}

function OverviewTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="Overview"
                lede="ASMR Curator pulls audio out of Patreon and Google Drive, and writes consistent filenames against a tag dictionary you control. Everything runs locally; nothing leaves your machine."
            />
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">A typical session</h3>
                <ol className="flex flex-col gap-2 text-sm text-muted-foreground leading-relaxed max-w-prose">
                    <li>
                        <span className="text-foreground/90">1.</span> Paste a Patreon post URL (or
                        creator URL) into the Source panel. The fetcher downloads the audio and
                        pre-fills title, tags, and artist from the post metadata.
                    </li>
                    <li>
                        <span className="text-foreground/90">2.</span> Tidy the tags. Any chip in
                        warm amber is a tag your dictionary doesn&apos;t know yet; right-click to
                        add it as a canonical or alias.
                    </li>
                    <li>
                        <span className="text-foreground/90">3.</span> Hit Generate filename and
                        then Rename and move. The file lands in your library under a folder you
                        pick.
                    </li>
                </ol>
            </section>
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Why four source modes</h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<Globe size={14} aria-hidden />}
                        title="Patreon URL"
                        body="The accurate path. Reads the post directly when the cookie is valid; pre-fills everything."
                    />
                    <HelpCard
                        icon={<Cloud size={14} aria-hidden />}
                        title="Google Drive"
                        body="The direct one. Paste a Drive address when you already have the link and there's no post to fetch first."
                    />
                    <HelpCard
                        icon={<FileText size={14} aria-hidden />}
                        title="Screenshot"
                        body="The fallback. A vision model reads the post from a screenshot when the fetcher cannot."
                    />
                    <HelpCard
                        icon={<FileAudio size={14} aria-hidden />}
                        title="File already on disk"
                        body="The bring-your-own. Drop files into Downloads, then file them with the library tools below."
                    />
                </div>
            </section>
        </article>
    );
}

function SetupTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="Getting started"
                lede="One-time setup so the Patreon and Drive paths can read your sessions. Cookies are small login files your browser stores so sites remember you're signed in; after this you only revisit when one expires (about 30 days for Patreon, 14 for Google)."
            />

            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">
                    1. Download the browser extension
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    Grab the latest{" "}
                    <code className="font-mono text-foreground/80">
                        asmr-curator-companion-vX.Y.Z.zip
                    </code>{" "}
                    from the project&apos;s GitHub Releases page. The extension is not on the Chrome
                    Web Store or AMO; you install it directly from the zip file.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    Unzip it somewhere you won&apos;t accidentally delete (a permanent folder, not
                    Downloads). The unzipped folder is what the next step asks for.
                </p>
            </section>

            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">
                    2. Install it in your browser
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    Pick the steps for the browser you actually use. Brave, Edge, Vivaldi, Opera,
                    and Arc all use the Chromium steps; Firefox forks like LibreWolf use the Firefox
                    steps; Zen has its own line below.
                </p>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<Globe size={14} aria-hidden />}
                        title="Chromium browsers (Chrome, Edge, Brave, Vivaldi, Opera, Arc)"
                        body="Visit chrome://extensions in the address bar. Turn on Developer mode (top-right corner). Click Load unpacked and pick the unzipped folder. The extension shows up in your toolbar; pin it via the puzzle-piece icon so it stays visible."
                    />
                    <HelpCard
                        icon={<Globe size={14} aria-hidden />}
                        title="Firefox (temporary install — resets when you close Firefox)"
                        body="Visit about:debugging#/runtime/this-firefox. Click Load Temporary Add-on and pick the manifest.json file inside the unzipped folder. The extension works until you close Firefox. Useful for trying it out; not for daily use."
                    />
                    <HelpCard
                        icon={<Globe size={14} aria-hidden />}
                        title="Firefox Developer Edition, Nightly, or Zen (persistent install)"
                        body="Visit about:config and set xpinstall.signatures.required to false (it's a Firefox setting that controls whether unsigned add-ons are allowed). Restart the browser. Then drag the .zip file onto the browser window to install. Regular Firefox (release / ESR) refuses unsigned extensions even with this setting; you need Developer Edition, Nightly, or a fork like Zen / LibreWolf."
                    />
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">3. Point it at the backend</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    Click the extension&apos;s icon in your toolbar, then click Settings. The
                    Backend URL field defaults to{" "}
                    <code className="font-mono text-foreground/80">http://localhost:8000</code>,
                    which is correct if the app is running on the same machine you&apos;re using the
                    browser on.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    Running it elsewhere? Type the address where it&apos;s reachable instead, like{" "}
                    <code className="font-mono text-foreground/80">http://192.168.1.50:8000</code>{" "}
                    for a home server, or{" "}
                    <code className="font-mono text-foreground/80">https://asmr.example.com</code>{" "}
                    behind a reverse proxy. Click Test connection to confirm; a green check means
                    you&apos;re good.
                </p>
            </section>

            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">4. Sign in and sync</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    In the same browser the extension lives in, sign in to{" "}
                    <span className="text-foreground/90">patreon.com</span> and{" "}
                    <span className="text-foreground/90">google.com</span>. Then either:
                </p>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground leading-relaxed max-w-prose list-disc pl-5">
                    <li>
                        Visit any Patreon page. A small floating Sync cookies pill appears in the
                        bottom-right corner; click it once.
                    </li>
                    <li>Or open the extension popup and click Sync Patreon and Google cookies.</li>
                </ul>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    A confirmation appears (e.g. &quot;Synced 12 Patreon + 47 Google&quot;). After
                    this, both workflows work until the sessions expire.
                </p>
            </section>

            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Troubleshooting</h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<Network size={14} aria-hidden />}
                        title="Test connection in Settings fails"
                        body="Check the Backend URL is reachable from the same browser. Open it in a new tab; you should see the app load. If not, the URL or the port is wrong, or a firewall is in the way."
                    />
                    <HelpCard
                        icon={<Cookie size={14} aria-hidden />}
                        title="Synced 0 cookies"
                        body="You're not signed in to that service in this browser profile. Sign in, then sync again. Private / Incognito windows don't share cookies with the main profile."
                    />
                    <HelpCard
                        icon={<Globe size={14} aria-hidden />}
                        title="Firefox says the extension is corrupt or unsigned"
                        body="Regular Firefox release / ESR refuses unsigned extensions, full stop. Switch to Firefox Developer Edition, Nightly, or a fork (Zen, LibreWolf) and set xpinstall.signatures.required to false in about:config. Or use the Load Temporary Add-on path for one session at a time."
                    />
                    <HelpCard
                        icon={<Cookie size={14} aria-hidden />}
                        title="Don't want the extension at all?"
                        body="The extension is a convenience; you don't strictly need it. Open Manage cookies in the app's Settings menu and paste the cookie values from your browser's devtools (Application or Storage tab). The same fields the extension would sync are editable here in plain text."
                    />
                </div>
            </section>
        </article>
    );
}

function PatreonTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="Patreon URL"
                lede="The primary path. Paste a URL, press Enter (or click Fetch), the backend pulls the post, the app pre-fills everything you need to confirm and ship."
            />
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Two URL shapes</h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<Globe size={14} aria-hidden />}
                        title="A single post URL"
                        body="Fetches just that post's audio. Useful for one-offs and re-runs."
                    />
                    <HelpCard
                        icon={<Globe size={14} aria-hidden />}
                        title="A creator URL"
                        body="Downloads the creator's full archive. Can take a while for a large back catalogue; you can keep working in the rest of the app while it runs."
                    />
                </div>
            </section>
            <HelpCard
                icon={<Sparkles size={14} aria-hidden />}
                title="Live progress while it runs"
                body="A small status line under the URL narrates what's happening: looking up the post, downloading X of Y MB, saving the file, moving on. A creator pull may scroll through many of these — that's normal, the app isn't stuck. After the last download it switches to wrapping up, tidying, and filing while the posts are sorted into your Downloads folder."
            />
            <HelpCard
                icon={<Cloud size={14} aria-hidden />}
                title="Drive-hosted audio still works"
                body="When a creator links to Google Drive instead of uploading to Patreon, an External links section appears under the post. Click Download next to the link and the app opens the link in the background using your Google sign-in and pulls the file down for you. Nothing downloads in your browser tab. Already have the Drive address, or can't fetch the post? The Google Drive tab takes the same link on its own."
            />
        </article>
    );
}

function DriveTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="Google Drive"
                lede="For audio that lives in Drive. Paste the file's address and it downloads straight away — no Patreon post needed first."
            />
            <HelpCard
                icon={<Cloud size={14} aria-hidden />}
                title="When to use this instead of the post"
                body="Drive links found on a post you've fetched still have their own Download buttons, and those stay the better route when you have them — the post supplies the creator and title. Use this tab when you already have the link, when the post can't be fetched, or when the audio isn't attached to a post at all."
            />
            <HelpCard
                icon={<Cookie size={14} aria-hidden />}
                title="It needs your Google session"
                body="The app opens the file in a background browser signed in as you, so your Google cookie has to be synced. If the session has lapsed you'll get a short message with a link straight to the cookie settings."
            />
            <HelpCard
                icon={<FolderOpen size={14} aria-hidden />}
                title="Creator and title are optional"
                body="They only decide which folder the download lands in — same shape as a Patreon download, so everything sits together. Leave them blank and the file is filed under Drive's own id for the file."
            />
            <HelpCard
                icon={<PenLine size={14} aria-hidden />}
                title="Use for filename"
                body="Fill in Creator and Title and this hands them to the tag editor, exactly as applying a fetched Patreon post does. Pipe-separated tags in the title split into chips and get matched against your dictionary, so Generate filename and the rename form work from them straight away."
            />
            <HelpCard
                icon={<FileAudio size={14} aria-hidden />}
                title="Convert after downloading"
                body="Off by default, which keeps whatever Drive serves — the fastest option, and it loses nothing. Turn it on to re-encode once the download lands, with the same output format and quality controls the Convert panel uses (MP3, FLAC, or OGG; power mode adds a bitrate override). Your choice is remembered and shared across every download path."
            />
            <HelpCard
                icon={<Sparkles size={14} aria-hidden />}
                title="If the link is rejected"
                body="The address needs to point at a single file — the one you get from Share, or from the address bar with the file open. A folder or My Drive listing has no file in it to download, and comes back asking for a file link."
            />
        </article>
    );
}

function ScreenshotTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="Screenshot fallback"
                lede="When the Patreon URL path refuses (rate limit, geo block, archived post), a vision model can read the post from a screenshot instead."
            />
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground leading-relaxed max-w-prose list-disc pl-5">
                <li>
                    Drop or paste a screenshot of the post page. The model extracts the title and
                    visible tags, then pre-fills the editor.
                </li>
                <li>The audio file itself is not downloaded by this path; you bring the audio.</li>
                <li>
                    Power mode shows the raw model output below the editor, useful when the
                    extraction looks off.
                </li>
            </ul>
        </article>
    );
}

function LibraryTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="The file library"
                lede="Two tabs on one list: Library is your curated archive, Downloads is the ingest staging area. The chrome is shared; only the root differs."
            />
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">The two tabs</h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<FolderOpen size={14} aria-hidden />}
                        title="Library"
                        body="Your archive. Curated, organised into folders you control. Rename and Move file things in here from Downloads."
                    />
                    <HelpCard
                        icon={<FolderOpen size={14} aria-hidden />}
                        title="Downloads"
                        body="Transient staging. Anything the Patreon and Drive fetches drop in here. Process and move; this folder isn't where you live."
                    />
                </div>
            </section>
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">What you can do on a file</h3>
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground leading-relaxed max-w-prose list-disc pl-5">
                    <li>
                        <span className="text-foreground/90">Rename and move</span>: write the
                        canonical filename and tags into the file&apos;s metadata, then file it into
                        a Library subfolder. Inside Move to library, renaming during the move and
                        writing tags during the move are separate checkboxes, both off unless you
                        tick them — a plain Move just relocates the file.
                    </li>
                    <li>
                        <span className="text-foreground/90">Convert</span>: re-encode any of WAV,
                        WMA, MP4, MOV, AVI, MKV, WebM, M4A, or AAC into MP3, FLAC, or OGG. The
                        conversion is what lets the tag writer attach a title and artist; the
                        formats in the first list can&apos;t hold those tag fields.
                    </li>
                    <li>
                        <span className="text-foreground/90">Browse</span>: open the folder-tree
                        sheet to navigate Library or Downloads, create folders, rename, and cut +
                        paste between subfolders.
                    </li>
                    <li>
                        <span className="text-foreground/90">Right-click a row</span>: Rename or
                        Delete shortcuts. With two or more files selected, you also get Bulk edit.
                    </li>
                </ul>
            </section>
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">
                    The filename and the title are separate
                </h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<FileAudio size={14} aria-hidden />}
                        title="Will become is editable"
                        body="It starts from the tags above, but you can type in it. That matters when a name runs past the length your filesystem allows — shorten it here and the Title field keeps every tag, instead of having to delete tags to make the name fit."
                    />
                    <HelpCard
                        icon={<FileText size={14} aria-hidden />}
                        title="An edited Title stays edited"
                        body="Once you change the Title by hand it stops following the generated one, so pressing Generate again won't overwrite what you wrote. Reset, next to either field, puts the generated value back."
                    />
                    <HelpCard
                        icon={<Sparkles size={14} aria-hidden />}
                        title="Tags without renaming"
                        body="When the filename already matches the file on disk, the button reads Save metadata and only the tags are written. Useful for fixing tags on a file that's already named correctly."
                    />
                </div>
            </section>
            <HelpCard
                icon={<MousePointerClick size={14} aria-hidden />}
                title="Multi-select works in both tabs"
                body="Click selects, Shift-click extends, Ctrl / Cmd-click toggles, Ctrl / Cmd + A selects all, drag selects a rectangle. The selection bar shows what you can do next, including Bulk edit when two or more are selected."
            />
        </article>
    );
}

function BulkTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="Bulk edit"
                lede="One sheet that writes metadata and renames across a selection. Pick two or more files in the file list, then click Bulk edit. Per-row title, tags, and filename, a shared block for artist / album / album artist / suffix, and an optional rename + move pass on commit."
            />
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">The two load buttons</h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<FileAudio size={14} aria-hidden />}
                        title="Load from file"
                        body="Re-reads the tags already stored inside each audio file into the per-row inputs. Auto-runs on open; the button is for re-syncing after edits land elsewhere."
                    />
                    <HelpCard
                        icon={<Cloud size={14} aria-hidden />}
                        title="Load from cached post info"
                        body="Pulls title and tags from the post details the app saved next to each file when it was downloaded. Useful when you want the Patreon info back as the source of truth."
                    />
                </div>
            </section>
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">
                    How the shared block behaves
                </h3>
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground leading-relaxed max-w-prose list-disc pl-5">
                    <li>
                        An empty shared input means &quot;leave each file alone&quot;. The backend
                        skips empty fields on write.
                    </li>
                    <li>
                        Click Clear next to a field to blank it across every selected file. The
                        input is disabled while clear is armed; click again to back out.
                    </li>
                    <li>
                        <code className="font-mono text-foreground/80">&lt;Mixed values&gt;</code>{" "}
                        as a placeholder means the loaded files disagree on that field. Typing
                        anything overrides every file with the typed value.
                    </li>
                    <li>
                        Same as artist mirrors Album artist to whatever you typed in Artist (the
                        common case for solo creators); uncheck it for compilation / collab files.
                    </li>
                </ul>
            </section>
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Rename and move</h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<FileAudio size={14} aria-hidden />}
                        title="Rename to canonical filenames"
                        body="Toggle Rename on to write each file's new filename when the commit lands. Each row gets its own Filename field you can type into, with a byte count under it — amber when the name is getting long, red when it's too long for your operating system to save. Shorten the filename there and that row's title keeps all its tags; Reset puts the generated name back."
                    />
                    <HelpCard
                        icon={<FolderOpen size={14} aria-hidden />}
                        title="Move to library"
                        body="When the selection lives in Downloads, an extra Move-to-library checkbox lets the same commit file every selected row into a Library subfolder you pick. The checkbox is hidden for Library-tab selections — they're already filed."
                    />
                </div>
            </section>
            <HelpCard
                icon={<MousePointerClick size={14} aria-hidden />}
                title="Open the dictionary while you work"
                body="The Dictionary button in the header opens the canonical-tags sheet on top of Bulk edit. All in-flight edits stay where they are; close the dictionary and you're back."
            />
        </article>
    );
}

function DictionaryTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="Tag dictionary"
                lede="One vocabulary the whole app reads from. A canonical tag is the one official spelling that ends up in filenames; aliases are the typo / casing variants that all map back to it; suppressed terms are words the extractor should always drop."
            />
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Three lists</h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<BookOpen size={14} aria-hidden />}
                        title="Vocabulary"
                        body="The canonical names plus their aliases. Drag to reorder when two aliases compete (lower in the list wins lookup). Click a row to edit."
                    />
                    <HelpCard
                        icon={<BookOpen size={14} aria-hidden />}
                        title="Suppressed"
                        body="Words the extractor always drops. Useful for marketing fluff that keeps showing up in titles."
                    />
                    <HelpCard
                        icon={<BookOpen size={14} aria-hidden />}
                        title="Tester"
                        body="Paste a title and watch how the dictionary normalises it. Read-only debug view, not a write surface."
                    />
                </div>
            </section>
            <HelpCard
                icon={<MousePointerClick size={14} aria-hidden />}
                title="Right-click a novel tag chip"
                body="Promote it to a new canonical, or add it as an alias of an existing one. Novel chips are the warm-amber ones; the dictionary doesn't recognise them yet."
            />
            <HelpCard
                icon={<BookOpen size={14} aria-hidden />}
                title="Empty dictionary on first run?"
                body="The Vocabulary and Suppressed lists each show their own empty-state with the next step. You can also use Import (top of the Dictionary sheet) to load a JSON file, or Reset to defaults to seed a starter vocabulary."
            />
        </article>
    );
}

function ShortcutsTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="Shortcuts and tips"
                lede="The non-obvious affordances. Nothing here is required, but each one saves a trip to the mouse."
            />

            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">
                    In the source panel (top of the page)
                </h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="Cmd / Ctrl + Enter"
                        body="Fires Generate filename from inside the title or format input. Useful when you're working through a batch and want to skip the mouse."
                    />
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="Enter in the Patreon URL or Google Drive field"
                        body="Submits the address and starts the fetch or download. No need to click the button."
                    />
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="Ctrl + V on the Screenshot tab"
                        body="Pastes whatever's on your clipboard as the screenshot. You don't have to click the upload area first."
                    />
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Selecting files in the list</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    Works the same in Library and Downloads tabs and in the Browse sheet.
                </p>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<MousePointerClick size={14} aria-hidden />}
                        title="Click, Shift-click, Ctrl / Cmd-click"
                        body="Click selects a single file. Shift-click extends the selection to that file. Ctrl / Cmd-click toggles a single file in or out of the selection."
                    />
                    <HelpCard
                        icon={<MousePointerClick size={14} aria-hidden />}
                        title="Drag to box-select"
                        body="Click and drag across the list to draw a rectangle. Every row inside it gets selected. Hold Ctrl or Shift while dragging to add to the existing selection instead of replacing it."
                    />
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="Ctrl / Cmd + A"
                        body="Selects every visible row in the current list. Use the filter input first to narrow what gets selected."
                    />
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="Esc"
                        body="Clears the file selection when no sheet or dialog is open. Inside a sheet, Esc handles the sheet's own cascade first (see below)."
                    />
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">In the Browse sheet</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    The Browse sheet (opened with the Browse button in the file library) has the
                    full file-manager shortcuts on top of the selection gestures above.
                </p>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="F2 to rename"
                        body="Renames the file or folder your cursor is hovering, or the only selected row. With multiple files selected, F2 does nothing (rename one at a time)."
                    />
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="Delete key to delete"
                        body="Prompts to delete the hovered file or, with multiple files selected, the whole selection. A confirm dialog appears first; nothing deletes silently."
                    />
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="N for new folder"
                        body="Creates a new folder in the current Library subdirectory. Ctrl / Cmd + N would conflict with the browser's New window shortcut, so it's plain N."
                    />
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="Ctrl / Cmd + X then Ctrl / Cmd + V"
                        body="Cut and paste selected files into a different Library subfolder. Navigate to the destination between Cut and Paste; the cut clipboard sticks around until you commit, replace, or hit Esc to clear it."
                    />
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Discoverable affordances</h3>
                <div className="flex flex-col gap-2.5">
                    <HelpCard
                        icon={<MousePointerClick size={14} aria-hidden />}
                        title="Right-click a tag chip"
                        body="On a warm-amber chip (the dictionary doesn't recognise it yet), right-click opens a menu to add it as a new canonical tag, or as an alias of an existing one. Click-to-edit still works for the chip text itself."
                    />
                    <HelpCard
                        icon={<MousePointerClick size={14} aria-hidden />}
                        title="Right-click a file row"
                        body="Per-row Rename and Delete in the main file list; the Browse sheet adds New folder, Cut, and Paste. Same actions as the toolbar buttons, faster to reach."
                    />
                    <HelpCard
                        icon={<Sparkles size={14} aria-hidden />}
                        title="Power mode"
                        body="Toggle in Settings (gear icon, top-right). Auto-expands More options on the source panels, surfaces the raw model output after a screenshot fetch, and adds a Bitrate slider to the Convert panel so you can pin a specific kbps target instead of trusting the preset."
                    />
                    <HelpCard
                        icon={<Keyboard size={14} aria-hidden />}
                        title="Esc cascades"
                        body="In the Browse and Bulk edit sheets, Esc peels off one layer of state at a time before closing the sheet. Examples: rename input, new-folder input, error banner, filter text, selection. Hit Esc again to keep peeling."
                    />
                </div>
            </section>
        </article>
    );
}

function SelfhostTopic() {
    return (
        <article className="flex flex-col gap-5">
            <TopicHeader
                title="Self-hosting"
                lede="The app is designed to run on your machine, your homelab, or your VPS. Two bind-mounted volumes, two cookie values, one image."
            />
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Backend URL</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
                    The extension defaults to{" "}
                    <code className="font-mono text-foreground/80">http://localhost:8000</code>.
                    When the backend runs anywhere else, set the Backend URL in the extension
                    Settings to wherever it's reachable (
                    <code className="font-mono text-foreground/80">http://10.0.0.5:8000</code>,{" "}
                    <code className="font-mono text-foreground/80">https://asmr.example.com</code>,
                    etc.). Click Test connection to confirm.
                </p>
            </section>
            <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Volumes</h3>
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground leading-relaxed max-w-prose list-disc pl-5">
                    <li>
                        <code className="font-mono text-foreground/80">LIBRARY_PATH</code>: your
                        curated archive. Backs the Library tab and the destination for every Move
                        and Rename and move.
                    </li>
                    <li>
                        <code className="font-mono text-foreground/80">DOWNLOAD_PATH</code>:
                        transient staging. Every fetch lands here first.
                    </li>
                    <li>
                        Both are required. They must be distinct directories; the backend refuses to
                        start otherwise.
                    </li>
                </ul>
            </section>
            <HelpCard
                icon={<Network size={14} aria-hidden />}
                title="Behind a reverse proxy"
                body="The app serves the UI and the API from the same port. Point your proxy at the backend port, set the extension's Backend URL to the public hostname, and you're done. The app only accepts requests from itself, not other websites — no extra configuration needed."
            />
        </article>
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
