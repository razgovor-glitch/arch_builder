import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: string[], fillPaths: string[] = []) {
  return function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...rest}
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
        {fillPaths.map((d) => (
          <path key={d} d={d} fill="currentColor" stroke="none" />
        ))}
      </svg>
    );
  };
}

export const IconUndo = make(['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11']);
export const IconRedo = make(['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13']);
export const IconSave = make(['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z', 'M17 21v-8H7v8', 'M7 3v5h8']);
export const IconDownload = make(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3']);
export const IconUpload = make(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12']);
export const IconHistory = make(['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l4 2']);
export const IconChevronDown = make(['m6 9 6 6 6-6']);
export const IconChevronLeft = make(['m15 18-6-6 6-6']);
export const IconChevronRight = make(['m9 18 6-6-6-6']);
export const IconPlay = make([], ['M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z']);
export const IconPause = make([], ['M6 4h4v16H6z', 'M14 4h4v16h-4z']);
export const IconSkipBack = make(['M19 20 9 12l10-8v16Z', 'M5 19V5']);
export const IconSkipForward = make(['m5 4 10 8-10 8V4Z', 'M19 5v14']);
export const IconRotate = make(['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5']);
export const IconBox = make(['M21 8 12 3 3 8v8l9 5 9-5V8Z', 'm3 8 9 5 9-5', 'M12 13v8']);
export const IconBook = make(['M4 19.5V5a2 2 0 0 1 2-2h14v18H6.5a2.5 2.5 0 0 1 0-5H20']);
export const IconList = make(['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01']);
export const IconCheck = make(['M20 6 9 17l-5-5']);
export const IconCheckCircle = make(['M22 11.1V12a10 10 0 1 1-5.9-9.1', 'm9 11 3 3L22 4']);
export const IconAlert = make(['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01']);
export const IconInfo = make(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 16v-4', 'M12 8h.01']);
export const IconX = make(['M18 6 6 18', 'm6 6 12 12']);
export const IconXCircle = make(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'm15 9-6 6', 'm9 9 6 6']);
export const IconPlus = make(['M12 5v14', 'M5 12h14']);
export const IconTrash = make(['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2']);
export const IconCopy = make(['M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1']);
export const IconImage = make(['M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z', 'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'm21 15-5-5L5 21']);
export const IconSend = make(['M5 12h14', 'm12 5 7 7-7 7']);
export const IconStop = make([], ['M6 6h12v12H6z']);
export const IconSpark = make(['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'm6.3 6.3 2.8 2.8', 'm14.9 14.9 2.8 2.8', 'm6.3 17.7 2.8-2.8', 'm14.9 9.1 2.8-2.8']);
export const IconSearch = make(['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3']);
export const IconMaximize = make(['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3']);
export const IconGrid = make(['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z']);
export const IconLink = make(['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7']);
export const IconTag = make(['M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z', 'M7 7h.01']);
export const IconChat = make(['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z']);
export const IconLibrary = make(['M4 4h4v16H4z', 'M10 4h4v16h-4z', 'm16 5 4 1-3 14-4-1z']);
export const IconWand = make(['m15 4 5 5', 'M3 21 15 9', 'M19 3v4', 'M21 5h-4', 'M6 3v2', 'M7 4H5']);
export const IconPrinter = make(['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z']);
export const IconLayout = make(['M3 3h18v18H3z', 'M3 9h18', 'M9 21V9']);
