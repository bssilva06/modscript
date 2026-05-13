import type { ReactNode } from 'react';

export function highlightLine(line: string): ReactNode {
  if (line.trimStart() === '---')
    return <span className="text-gray-400 dark:text-gray-500">---</span>;

  if (/^\s*#/.test(line))
    return <span className="text-gray-400 dark:text-gray-500 italic">{line}</span>;

  const keyMatch = line.match(/^(\s*)([\w ()[\],]+?)(\s*:\s*)(.*)$/);
  if (keyMatch) {
    const [, indent, key, colon, rest] = keyMatch;
    return (
      <>
        {indent ?? ''}
        <span className="text-blue-600 dark:text-blue-400">{key ?? ''}</span>
        <span className="text-gray-400 dark:text-gray-500">{colon ?? ''}</span>
        {colorValue(rest ?? '')}
      </>
    );
  }

  const listMatch = line.match(/^(\s*- )(.*)$/);
  if (listMatch) {
    const [, dash, rest] = listMatch;
    return (
      <>
        <span className="text-gray-400 dark:text-gray-500">{dash ?? ''}</span>
        {colorValue(rest ?? '')}
      </>
    );
  }

  return <>{colorValue(line)}</>;
}

function colorValue(text: string): ReactNode {
  const t = text.trim();
  if (/^["'].*["']$/.test(t))
    return <span className="text-amber-600 dark:text-amber-400">{text}</span>;
  if (/^(true|false|null)$/.test(t))
    return <span className="text-purple-600 dark:text-purple-400">{text}</span>;
  if (/^-?\d+(\.\d+)?$/.test(t))
    return <span className="text-orange-500 dark:text-orange-400">{text}</span>;
  return <>{text}</>;
}
