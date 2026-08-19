import type { CSSProperties, ReactNode } from 'react';

/**
 * Initial state for a GridChild component
 */
export interface GridChildInitial {
  /** Initial X coordinate in px */
  x: number;
  /** Initial Y coordinate in px */
  y: number;
  /** Initial width in px */
  width: number;
  /** Initial height in px */
  height: number;
  /** Initial zoom/scale (default: 1) */
  zoom?: number;
}

/**
 * Represents a child component that can be positioned within the Grid.
 * Each child has a position, size, and render function.
 */
export interface GridChild {
  /** X coordinate in px */
  x: number;
  /** Y coordinate in px */
  y: number;
  /** Width in px */
  width: number;
  /** Height in px */
  height: number;
  /** Zoom/scale factor for the child (default: 1) */
  zoom?: number;
  /** Whether the child is minimized */
  minimized?: boolean;
  /** Whether the child is maximized (displayed full-screen instead of in grid) */
  maximized?: boolean;
  /** Initial state for reset functionality */
  initial?: GridChildInitial;
  /** Name of the component to render */
  component: string;
  /** Unique identifier for the child */
  id: string;
  /** Display title for the child */
  title: string;
  /**
   * If true, the child will remain mounted even when outside the viewport.
   * Useful for components that need to maintain state or perform background operations.
   */
  persistent?: boolean;
  /** Whether the child can be closed */
  canClose?: boolean;
  /** Props for the component */
  props?: any;
}

export interface ChildState {
  /** Whether the child is selected */
  isSelected: boolean;
  /** Whether the child is minimized */
  isMinimized: boolean;
  /** Whether the child is maximized */
  isMaximized: boolean;
}

export type GridComponent = (gridChild: GridChild, state: ChildState) => ReactNode;

/**
 * Configuration for a placeholder component that follows the mouse until placed.
 */
export interface PlaceholderConfig {
  /** Type of component being placed */
  componentType: string;
  /** Title/name for the placeholder */
  title: string;
  /** Width of the placeholder in pixels */
  width: number;
  /** Height of the placeholder in pixels */
  height: number;
  /** Callback when the placeholder is placed - receives world coordinates */
  onPlaced: (x: number, y: number) => void;
  /** Optional callback when placement is cancelled */
  onCancel?: () => void;
}

/**
 * Options for zooming to a specific area
 */
export interface ZoomToOptions {
  /** Target x coordinate */
  x: number;
  /** Target y coordinate */
  y: number;
  /** Target zoom level */
  zoom?: number;
  /** Whether to animate the transition (default: false) */
  animate?: boolean;
}

/**
 * Options for focusing on a child component
 */
export interface FocusChildOptions {
  /** ID of the child to focus */
  childId: string;
  /** Padding around the child in pixels (default: 200) */
  padding?: number;
  /** Target zoom level (default: 1) */
  zoom?: number;
  /** Whether to animate the transition (default: false) */
  animate?: boolean;
}

/**
 * Grid component ref API for programmatic control
 */
export interface GridRef {
  /** Zoom to a specific position and zoom level */
  zoomTo: (options: ZoomToOptions) => void;
  /** Focus on a specific child component */
  focusChild: (options: FocusChildOptions) => void;
  /** Get current viewport state */
  getViewport: () => ViewportState;
  /** Set viewport state */
  setViewport: (viewport: ViewportState) => void;
  /** Zoom in by one step */
  zoomIn: () => void;
  /** Zoom out by one step */
  zoomOut: () => void;
  /** Reset zoom to 100% */
  resetZoom: () => void;
}

/**
 * Props for the Grid component.
 */
export interface GridProps {
  /** Array of child components to render in the grid */
  children: GridChild[];
  /** Map of component names to their render functions */
  components: Record<string, GridComponent>;
  /** Optional CSS styles for the grid container */
  style?: CSSProperties;
  /** Size of each grid cell in pixels (default: 20) */
  gridSize?: number;
  /** ID of the currently selected child */
  selectedChildId?: string | null;
  /** Callback when a child is selected */
  onChildSelect?: (childId: string | null) => void;
  /** Callback when a component is blurred (deselected) */
  onComponentBlur?: (childId: string) => void;
  /** Callback when viewport changes - used for saving state, not for controlling the viewport */
  onViewportChange?: (viewport: ViewportState) => void;
  /** Callback when children change (for controlled mode) */
  onChildrenChange?: (children: GridChild[]) => void;
  /** Callback when a child requests to be maximized/restored */
  onMaximize?: (childId: string) => void;
  /** Initial viewport state (used only on mount, not controlled) */
  initialViewport?: ViewportState;
  /** Whether to show the background grid lines (default: true) */
  showGrid?: boolean;
  /** Grid rendering style: 'lines' for grid lines, 'dots' for dots at intersections (default: 'lines') */
  gridStyle?: 'lines' | 'dots';
  /** Placeholder configuration for component placement flow */
  placeholder?: PlaceholderConfig;
  /** Whether to show built-in zoom controls (default: true) */
  showZoomControls?: boolean;
}

/**
 * Represents the current state of the viewport including position and zoom level.
 */
export interface ViewportState {
  /** Current X offset of the viewport */
  x: number;
  /** Current Y offset of the viewport */
  y: number;
  /** Current zoom level (1.0 = 100%) */
  zoom: number;
}

export type ResizeHandle =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

// Simple viewport stream implementation
export class ViewportStream {
  currentViewport: ViewportState;

  constructor(initialViewport: ViewportState) {
    this.currentViewport = initialViewport;
  }

  private subscribers: ((viewport: ViewportState) => void)[] = [];

  subscribe(callback: (viewport: ViewportState) => void) {
    this.subscribers.push(callback);
    return () => {
      const index = this.subscribers.indexOf(callback);
      if (index > -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  next(nextViewport: ViewportState) {
    this.currentViewport = nextViewport;
    this.subscribers.forEach((callback) => callback(nextViewport));
  }
}
