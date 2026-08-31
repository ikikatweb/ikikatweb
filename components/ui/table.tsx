"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({
  className,
  containerClassName,
  noWrapper,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string; noWrapper?: boolean }) {
  const table = (
    <table
      data-slot="table"
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  )
  if (noWrapper) return table
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-auto max-h-[75vh]", containerClassName)}
    >
      {table}
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // z-20: sabit BAŞLIK satırı sabit sütun hücrelerinin ÜSTÜNDE kalsın.
      //
      // DİKKAT — sabit sütun (sticky left-0) GÖVDE hücrelerine z-index VERMEYİN. Tarayıcıda
      // ölçüldü: gövde <td>'sine pozitif bir z-index (z-10 / zIndex:5) verildiğinde hücre, bu
      // thead'in z-20'sine RAĞMEN başlığın üstüne çiziliyor ve dikey kaydırmada başlık metni
      // (ör. "Plaka") gövde değeriyle örtülüyor. Başlık hücresine daha yüksek z vermek de
      // çözmüyor (th, thead'in yığın bağlamına sıkışıyor).
      // Doğrusu: gövde hücresi yalnız "sticky left-0" olsun — z-index'siz sticky hücre zaten
      // konumsuz komşu hücrelerin üstünde kalır, yani yatay sabitleme bozulmaz.
      className={cn("[&_tr]:border-b sticky top-0 z-20", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
