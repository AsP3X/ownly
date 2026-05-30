// Human: Ownly context menu primitives on Base UI — Pencil explorer menus (login-signup.pencil).
// Agent: EXPORTS ContextMenu*; Tailwind maps #2563EB / #F7F8FA / #E5E7EB; SubmenuTrigger uses safePolygon; no cursor-* utilities.

import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"

import { cn } from "@/lib/utils"
import { ChevronRightIcon, CheckIcon } from "lucide-react"

/** Human: Popup shell tokens shared by root and submenu surfaces. */
// Agent: READS Ownly Pencil menu frames; USED by Content + SubContent classNames.
const ownlyMenuSurfaceClassName =
  "z-50 max-h-(--available-height) min-w-0 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white p-1.5 text-[#1A1A1A] shadow-[0_8px_16px_rgba(0,0,0,0.08)] outline-none duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"

/** Human: Default row hover/focus — light gray fill, body text stays primary. */
// Agent: APPLIES to items and checkbox/radio rows; destructive/primary override colors.
const ownlyMenuRowInteractiveClassName =
  "rounded-lg px-3 py-2 text-[13px] leading-none outline-hidden select-none hover:bg-[#F7F8FA] focus:bg-[#F7F8FA] data-disabled:pointer-events-none data-disabled:opacity-50"

function ContextMenu({
  modal,
  ...props
}: ContextMenuPrimitive.Root.Props & {
  // Human: Base UI omits modal from ContextMenu types but Menu.Root still honors it at runtime.
  // Agent: modal={false} prevents inert/aria-hidden from blanking the page behind the menu.
  modal?: boolean
}) {
  const rootProps = {
    ...props,
    ...(modal !== undefined ? { modal } : {}),
  }

  return (
    <ContextMenuPrimitive.Root
      data-slot="context-menu"
      {...(rootProps as ContextMenuPrimitive.Root.Props)}
    />
  )
}

function ContextMenuPortal({ ...props }: ContextMenuPrimitive.Portal.Props) {
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
  )
}

function ContextMenuTrigger({
  className,
  ...props
}: ContextMenuPrimitive.Trigger.Props) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  align = "start",
  alignOffset,
  side,
  sideOffset,
  ...props
}: ContextMenuPrimitive.Popup.Props &
  Pick<
    ContextMenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        {...(alignOffset !== undefined ? { alignOffset } : {})}
        {...(side !== undefined ? { side } : {})}
        {...(sideOffset !== undefined ? { sideOffset } : {})}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(ownlyMenuSurfaceClassName, className)}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuGroup({ ...props }: ContextMenuPrimitive.Group.Props) {
  return (
    <ContextMenuPrimitive.Group
      data-slot="context-menu-group"
      className="flex flex-col gap-0.5"
      {...props}
    />
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: ContextMenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "truncate px-3 py-1.5 text-[11px] font-semibold tracking-wide text-[#888888] uppercase data-inset:pl-9",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ContextMenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive" | "primary"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/context-menu-item relative flex w-full items-center gap-2.5",
        ownlyMenuRowInteractiveClassName,
        "text-[#1A1A1A] focus:text-[#1A1A1A]",
        "data-[variant=primary]:font-semibold data-[variant=primary]:text-[#2563EB] data-[variant=primary]:hover:text-[#2563EB] data-[variant=primary]:focus:text-[#2563EB]",
        "data-[variant=destructive]:text-[#EF4444] data-[variant=destructive]:hover:text-[#EF4444] data-[variant=destructive]:focus:text-[#EF4444] data-[variant=destructive]:hover:bg-[#F7F8FA] data-[variant=destructive]:focus:bg-[#F7F8FA]",
        "data-inset:pl-9",
        "[&>svg:first-child]:size-3.5 [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-[#666666]",
        "data-[variant=primary]:[&>svg:first-child]:text-[#2563EB]",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSub({ ...props }: ContextMenuPrimitive.SubmenuRoot.Props) {
  return (
    <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
  )
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ContextMenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex w-full items-center justify-between gap-2",
        ownlyMenuRowInteractiveClassName,
        "text-[#1A1A1A] data-open:bg-[#F7F8FA] data-open:font-semibold data-open:text-[#2563EB] hover:font-semibold hover:text-[#2563EB] focus:font-semibold focus:text-[#2563EB]",
        "data-inset:pl-9",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3 shrink-0 text-[#2563EB]" />
    </ContextMenuPrimitive.SubmenuTrigger>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuContent>) {
  return (
    <ContextMenuContent
      data-slot="context-menu-sub-content"
      className={cn("w-[160px]", className)}
      side="right"
      alignOffset={-4}
      sideOffset={-4}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: ContextMenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex w-full items-center gap-2 pr-8 pl-3",
        ownlyMenuRowInteractiveClassName,
        "text-[#1A1A1A] data-inset:pl-9",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-3.5 text-[#2563EB]" />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioGroup({
  ...props
}: ContextMenuPrimitive.RadioGroup.Props) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  )
}

function ContextMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: ContextMenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex w-full items-center gap-2 pr-8 pl-3",
        ownlyMenuRowInteractiveClassName,
        "text-[#1A1A1A] data-inset:pl-9",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.RadioItemIndicator>
          <CheckIcon className="size-3.5 text-[#2563EB]" />
        </ContextMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: ContextMenuPrimitive.Separator.Props) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("my-0.5 h-px w-full bg-[#E5E7EB]", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn("ml-auto text-[11px] text-[#888888]", className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
