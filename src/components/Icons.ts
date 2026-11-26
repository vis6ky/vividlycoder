import { svg } from '@samrey/runtime';

function makeIcon(className: string, paths: Array<{ tag: string; attrs: Record<string, string | number> }>): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.75',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: className,
      'aria-hidden': 'true',
    },
    ...paths.map((p) => svg(p.tag, p.attrs))
  );
}

export function BrandLogoIcon(className = 'w-5 h-5'): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      class: className,
      'aria-hidden': 'true',
    },
    svg('rect', {
      x: '2.5',
      y: '2.5',
      width: '19',
      height: '19',
      rx: '5',
      fill: '#141820',
      stroke: '#3B82F6',
      'stroke-width': '1.6',
    }),
    svg('path', {
      d: 'M7.5 8.5L11 12L7.5 15.5',
      stroke: '#E6E9EF',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
    svg('path', {
      d: 'M12.5 15.5H16.5',
      stroke: '#3B82F6',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
    })
  );
}

export function PlusIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'path', attrs: { d: 'M12 5v14' } },
    { tag: 'path', attrs: { d: 'M5 12h14' } },
  ]);
}

export function ChatIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'path', attrs: { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' } },
  ]);
}

export function FolderIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'path', attrs: { d: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z' } },
  ]);
}

export function SettingsIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'path', attrs: { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } },
  ]);
}

export function SendIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'path', attrs: { d: 'M5 12h14' } },
    { tag: 'path', attrs: { d: 'm12 5 7 7-7 7' } },
  ]);
}

export function StopIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'rect', attrs: { x: '6', y: '6', width: '12', height: '12', rx: '2', fill: 'currentColor' } },
  ]);
}

export function CopyIcon(className = 'w-3.5 h-3.5'): SVGElement {
  return makeIcon(className, [
    { tag: 'rect', attrs: { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' } },
    { tag: 'path', attrs: { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' } },
  ]);
}

export function CheckIcon(className = 'w-3.5 h-3.5'): SVGElement {
  return makeIcon(className, [
    { tag: 'path', attrs: { d: 'M20 6 9 17l-5-5' } },
  ]);
}

export function RefreshIcon(className = 'w-3.5 h-3.5'): SVGElement {
  return makeIcon(className, [
    { tag: 'path', attrs: { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' } },
    { tag: 'path', attrs: { d: 'M3 3v5h5' } },
    { tag: 'path', attrs: { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' } },
    { tag: 'path', attrs: { d: 'M16 16h5v5' } },
  ]);
}

export function SearchIcon(className = 'w-3.5 h-3.5'): SVGElement {
  return makeIcon(className, [
    { tag: 'circle', attrs: { cx: '11', cy: '11', r: '8' } },
    { tag: 'path', attrs: { d: 'm21 21-4.3-4.3' } },
  ]);
}

export function TrashIcon(className = 'w-3.5 h-3.5'): SVGElement {
  return makeIcon(className, [
    { tag: 'path', attrs: { d: 'M3 6h18' } },
    { tag: 'path', attrs: { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' } },
    { tag: 'path', attrs: { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' } },
  ]);
}

export function AlertIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
    { tag: 'path', attrs: { d: 'M12 8v4' } },
    { tag: 'path', attrs: { d: 'M12 16h.01' } },
  ]);
}

export function MenuIcon(className = 'w-5 h-5'): SVGElement {
  return makeIcon(className, [
    { tag: 'line', attrs: { x1: '4', x2: '20', y1: '6', y2: '6' } },
    { tag: 'line', attrs: { x1: '4', x2: '20', y1: '12', y2: '12' } },
    { tag: 'line', attrs: { x1: '4', x2: '20', y1: '18', y2: '18' } },
  ]);
}

export function CloseIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'path', attrs: { d: 'M18 6 6 18' } },
    { tag: 'path', attrs: { d: 'm6 6 12 12' } },
  ]);
}

export function CodeIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'polyline', attrs: { points: '16 18 22 12 16 6' } },
    { tag: 'polyline', attrs: { points: '8 6 2 12 8 18' } },
  ]);
}

export function ServerIcon(className = 'w-4 h-4'): SVGElement {
  return makeIcon(className, [
    { tag: 'rect', attrs: { width: '20', height: '8', x: '2', y: '2', rx: '2', ry: '2' } },
    { tag: 'rect', attrs: { width: '20', height: '8', x: '2', y: '14', rx: '2', ry: '2' } },
    { tag: 'line', attrs: { x1: '6', x2: '6.01', y1: '6', y2: '6' } },
    { tag: 'line', attrs: { x1: '6', x2: '6.01', y1: '18', y2: '18' } },
  ]);
}
