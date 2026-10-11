import {
  createLucideIcon,
  type IconNode,
  type LucideProps,
} from 'lucide-react';

// A shared 24px grid and rounded strokes keep our custom symbols consistent
// from compact controls to section headings, using the existing Lucide renderer.
function createAppIcon(name: string, nodes: IconNode) {
  const Icon = createLucideIcon(name, nodes);

  return function AppIcon({ strokeWidth = 1.75, ...props }: LucideProps) {
    return <Icon strokeWidth={strokeWidth} {...props} />;
  };
}

export const SwapIcon = createAppIcon('SwapCircleSwap', [
  ['path', { d: 'M4 10a8 8 0 0 1 13-4l3 3', key: 'upper-arc' }],
  ['path', { d: 'M20 4v5h-5', key: 'upper-arrow' }],
  ['path', { d: 'M20 14a8 8 0 0 1-13 4l-3-3', key: 'lower-arc' }],
  ['path', { d: 'M4 20v-5h5', key: 'lower-arrow' }],
]);

export const CommunityIcon = createAppIcon('SwapCircleCommunity', [
  [
    'path',
    {
      d: 'M13 14H8l-4 3v-5a5 5 0 0 1-2-4c0-3 2.5-5 6-5s6 2 6 5c0 1-.3 2-1 3',
      key: 'first-bubble',
    },
  ],
  [
    'path',
    {
      d: 'M17 9c3 0 5 2 5 5 0 1.6-.7 3-2 4v3l-3-2h-2c-3 0-5-2-5-5',
      key: 'second-bubble',
    },
  ],
  ['path', { d: 'M6 8h4M15 14h3', key: 'conversation' }],
]);

export const ListingsIcon = createAppIcon('SwapCircleListings', [
  [
    'path',
    { d: 'M5 8h14l1 11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2L5 8Z', key: 'tote' },
  ],
  ['path', { d: 'M8 9V6a4 4 0 0 1 8 0v3', key: 'handle' }],
  ['path', { d: 'M9 17c-1-4 2-5 6-5 0 4-2 6-6 5Zm0 0 3-3', key: 'leaf' }],
]);

export const AccountIcon = createAppIcon('SwapCircleAccount', [
  ['path', { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', key: 'frame' }],
  ['path', { d: 'M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', key: 'head' }],
  ['path', { d: 'M6 18c.5-3 2.5-4 6-4s5.5 1 6 4', key: 'shoulders' }],
]);

export const LocationIcon = createAppIcon('SwapCircleLocation', [
  ['path', { d: 'M18 9c0 5-6 10-6 10S6 14 6 9a6 6 0 1 1 12 0Z', key: 'pin' }],
  ['circle', { cx: '12', cy: '9', r: '2', key: 'center' }],
  [
    'path',
    {
      d: 'M5 19c-1 .4-2 .9-2 1.5C3 21.9 7 23 12 23s9-1.1 9-2.5c0-.6-1-1.1-2-1.5',
      key: 'ground',
    },
  ],
]);

export const NotificationIcon = createAppIcon('SwapCircleNotification', [
  [
    'path',
    {
      d: 'M9 4a6 6 0 0 0-3 5v3c0 2-1 3-2 5h16c-1-2-2-3-2-5V9a6 6 0 0 0-3-5',
      key: 'bell',
    },
  ],
  ['path', { d: 'M10 4a2 2 0 0 1 4 0M9 20c1 2 5 2 6 0', key: 'ends' }],
]);

export const ForwardIcon = createAppIcon('SwapCircleForward', [
  ['path', { d: 'M4 14c4-2 8-2 15-2M14 6l6 6-6 6', key: 'arrow' }],
]);

export const AddIcon = createAppIcon('SwapCircleAdd', [
  [
    'rect',
    { x: '3', y: '3', width: '18', height: '18', rx: '6', key: 'frame' },
  ],
  ['path', { d: 'M8 12h8M12 8v8', key: 'plus' }],
]);

export const ExpandIcon = createAppIcon('SwapCircleExpand', [
  ['path', { d: 'm6 9 4.6 4.6a2 2 0 0 0 2.8 0L18 9', key: 'chevron' }],
]);

export const CloseIcon = createAppIcon('SwapCircleClose', [
  ['path', { d: 'm7 7 10 10M17 7 7 17', key: 'cross' }],
]);

export const UnavailableImageIcon = createAppIcon(
  'SwapCircleUnavailableImage',
  [
    [
      'path',
      {
        d: 'M14 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-8',
        key: 'frame',
      },
    ],
    [
      'path',
      { d: 'm3 16 4-4 7 7 3-3 4 4M17 3l4 4M21 3l-4 4', key: 'landscape' },
    ],
    ['circle', { cx: '9', cy: '7', r: '1', key: 'sun' }],
  ],
);
