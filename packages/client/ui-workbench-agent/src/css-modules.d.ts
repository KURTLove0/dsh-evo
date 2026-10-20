declare module '*.module.css' {
  const classes: Record<string, string> & { editorModal: string; editorContent: string }
  export default classes
}
