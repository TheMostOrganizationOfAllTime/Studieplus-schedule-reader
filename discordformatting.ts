import { HTMLElement, Node, parse, TextNode } from 'node-html-parser'

export function htmlToDiscord(html: string): string {
    const root = parse(html, {
        blockTextElements: {
            script: false,
            noscript: false,
            style: false,
            pre: true,
        },
    })

    function render(node: Node): string {
        if (node instanceof TextNode) {
            return node.rawText.replaceAll(/\s+/gu, ' ')
        }

        if (!(node instanceof HTMLElement)) {
            return ''
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const tag = node.tagName?.toLowerCase()
        const children = node.childNodes.map(render).join('')
        if (!tag) {
            return children
        }

        switch (tag) {
            // Bold
            case 'b':
            case 'strong':
                return wrap(children, '**')

            // Italic
            case 'i':
            case 'em':
                return wrap(children, '*')

            // Underline
            case 'u':
                return wrap(children, '__')

            // Strikethrough
            case 's':
            case 'strike':
            case 'del':
                return wrap(children, '~~')

            // Code
            case 'code':
                if (children.trim().includes('\n')) {
                    return `\n\`\`\`\n${children.trim()}\n\`\`\`\n`
                }
                return `\`${children.trim()}\``

            // Code block
            case 'pre':
                return `\n\`\`\`\n${children.trim()}\n\`\`\`\n`

            // Links
            case 'a': {
                const href = node.getAttribute('href')
                const text = children.trim()

                if (!href || text === href) {
                    return text
                }

                if (isWebAddress(href)) {
                    return `[${text}](${/^https:\/\/|^http:\/\//u.test(href) ? href : 'https://' + href})`
                }

                return href
            }

            // Line break
            case 'br':
                return '\n'

            // List item
            case 'li':
                return `* ${children.trim()}\n`

            // Lists
            case 'ul':
            case 'ol':
                return `${children.trim()}\n`

            // Block-level elements
            case 'div':
            case 'p':
            case 'section':
            case 'article':
            case 'header':
            case 'footer':
            case 'main':
            case 'aside':
            case 'blockquote':
            case 'table':
            case 'tr':
                return wrap(children, '\n')

            // Headings
            case 'h1':
                return `# ${children.trim()}\n`

            case 'h2':
                return `## ${children.trim()}\n`

            case 'h3':
                return `### ${children.trim()}\n`

            case 'h4':
            case 'h5':
            case 'h6':
                return `**${children.trim()}**\n`

            default:
                return children
        }
    }

    return cleanup(render(root))
}

/**
 * Wraps text only if it contains non-whitespace.
 */
function wrap(text: string, wrapper: string): string {
    const trimmed = text.trim()

    if (!trimmed) {
        return ''
    }

    return `${wrapper}${trimmed}${wrapper}`
}

/**
 * Cleans up excessive whitespace/newlines.
 */
function cleanup(text: string): string {
    return (
        text
            // Remove spaces before newlines
            .replaceAll(/[ \t]+\n/gu, '\n')

            // Collapse 3+ newlines into max 2
            .replaceAll(/\n{3,}/gu, '\n\n')

            // Collapse repeated spaces
            .replaceAll(/[ \t]{2,}/gu, ' ')

            // Trim final output
            .trim()
    )
}

function isWebAddress(str: string): boolean {
    try {
        return new URL(
            /^https:\/\/|^http:\/\//u.test(str) ? str : `https://${str}`,
        ).hostname.includes('.')
    } catch {
        return false
    }
}
