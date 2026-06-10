declare interface Window {
  projector: import('../../shared/types').ProjectorApi
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: import('react').DetailedHTMLProps<
      import('react').HTMLAttributes<HTMLElement>,
      HTMLElement
    > & {
      src?: string
      useragent?: string
      webpreferences?: string
      partition?: string
      allowpopups?: string
    }
  }
}
