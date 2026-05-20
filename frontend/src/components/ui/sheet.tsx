"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// shadcn-style Sheet primitive. Hardcoded to slide from the right edge —
// the only edge this codebase uses. Overlay routes through the shared
// `bg-scrim/30` token so its backdrop matches the Dialog primitive (no
// pure-black scrims anywhere).

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
    return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
    return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
    className,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
    return (
        <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className={cn(
                "fixed inset-0 isolate z-50 bg-scrim/30 duration-100 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
                className,
            )}
            {...props}
        />
    );
}

function SheetContent({
    className,
    children,
    showCloseButton = true,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
    showCloseButton?: boolean;
}) {
    return (
        <SheetPortal>
            <SheetOverlay />
            <SheetPrimitive.Content
                data-slot="sheet-content"
                className={cn(
                    "fixed inset-y-0 right-0 z-50 h-full flex flex-col bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/5 dark:ring-foreground/10 border-l border-border rounded-l-2xl duration-300 outline-none data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right",
                    className,
                )}
                {...props}
            >
                {children}
                {showCloseButton && (
                    <SheetPrimitive.Close data-slot="sheet-close" asChild>
                        <Button
                            variant="ghost"
                            className="absolute top-4 right-4 bg-secondary"
                            size="icon-sm"
                        >
                            <XIcon />
                            <span className="sr-only">Close</span>
                        </Button>
                    </SheetPrimitive.Close>
                )}
            </SheetPrimitive.Content>
        </SheetPortal>
    );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
    return (
        <SheetPrimitive.Title
            data-slot="sheet-title"
            className={cn("font-heading text-base leading-none font-medium", className)}
            {...props}
        />
    );
}

function SheetDescription({
    className,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
    return (
        <SheetPrimitive.Description
            data-slot="sheet-description"
            className={cn("text-sm text-muted-foreground", className)}
            {...props}
        />
    );
}

export {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetOverlay,
    SheetPortal,
    SheetTitle,
    SheetTrigger,
};
