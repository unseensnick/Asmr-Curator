import { type ComponentProps } from "react";
import { Button } from "@/components/ui/button";

interface AsyncButtonProps extends ComponentProps<typeof Button> {
    /** Whether the async action is currently running. */
    loading?: boolean;
    /**
     * Label to show while loading. If omitted, the original children are
     * kept and only the spinner appears beside them. The button is
     * automatically `disabled` while loading.
     */
    loadingLabel?: string;
}

/**
 * Drop-in replacement for `<Button>` with a `loading` state.
 *
 * - Shows a spinner instead of the leading icon while loading.
 * - Automatically disables the button while loading (overrides `disabled`).
 * - Swaps to `loadingLabel` if provided; otherwise keeps the children.
 *
 * Anything specific to a single callsite (a success-flash background,
 * a custom icon when idle) is still handled by the caller via `children`
 * and `className`. This wrapper only owns the loading affordance.
 */
export default function AsyncButton({
    loading = false,
    loadingLabel,
    disabled,
    children,
    ...rest
}: AsyncButtonProps) {
    return (
        <Button disabled={loading || disabled} {...rest}>
            {loading && <Spinner />}
            {loading && loadingLabel ? loadingLabel : children}
        </Button>
    );
}

function Spinner() {
    return (
        <span
            aria-hidden
            className="size-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin shrink-0"
        />
    );
}
