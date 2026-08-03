/**
 * The design layer: presentational primitives only.
 *
 * Nothing in here may import from `domain/`, `data/`, or `features/`. If a
 * component needs to know what a Job is, it belongs in `patterns/` instead.
 */
export { cn } from './cn';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { Card, CardHeader, CardBody, CardFooter } from './Card';
export {
  Badge,
  StatusDot,
  ToneText,
  Progress,
  Skeleton,
  EmptyState,
  Kbd,
  type Tone,
} from './Feedback';
export { Label, Input, Textarea, Select, SearchInput, SegmentedControl } from './Form';
export { Dialog, Drawer, Popover, Tooltip, TooltipProvider } from './Overlay';
export { DataTable, type Column } from './DataTable';
export { Tabs, TabPanel, type TabItem } from './Tabs';
