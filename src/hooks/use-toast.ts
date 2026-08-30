import * as React from "react"
import { toast as hotToast, type ToastOptions } from "react-hot-toast"

type ToastVariant = "default" | "destructive"

type ToastInput = {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  variant?: ToastVariant
  duration?: number
}

function renderToastContent({ title, description, action }: ToastInput) {
  if (!description && !action) {
    return title ?? "Notification"
  }

  return React.createElement(
    "div",
    { className: "space-y-1" },
    title
      ? React.createElement("div", { className: "font-medium" }, title)
      : null,
    description
      ? React.createElement(
          "div",
          { className: "text-sm opacity-90" },
          description,
        )
      : null,
    action
      ? React.createElement("div", { className: "pt-1" }, action)
      : null,
  )
}

function presentToast(input: ToastInput, id?: string) {
  const options: ToastOptions = {
    id,
    duration: input.duration,
  }
  const message = renderToastContent(input)

  return input.variant === "destructive"
    ? hotToast.error(message, options)
    : hotToast(message, options)
}

function toast(input: ToastInput) {
  const id = presentToast(input)

  return {
    id,
    dismiss: () => hotToast.dismiss(id),
    update: (next: ToastInput) => presentToast({ ...input, ...next }, id),
  }
}

function useToast() {
  return {
    toasts: [],
    toast,
    dismiss: (toastId?: string) => {
      if (toastId) {
        hotToast.dismiss(toastId)
        return
      }
      hotToast.dismiss()
    },
  }
}

export { useToast, toast }
