import React, { useRef, useEffect, useState, useCallback } from 'react';
import { DeleteIcon, GridOffIcon, GridOnIcon } from './icons';
import { ViewportStream } from './types';
import type { GridChild, ResizeHandle } from './types';

type FrameChild = GridChild & {
  snapToCells?: boolean;
};

interface FrameProps {
  child: FrameChild;
  isSelected: boolean;
  zoom: number;
  viewport$: ViewportStream;
  onMove: (deltaX: number, deltaY: number) => void;
  onResize: (deltaWidth: number, deltaHeight: number, shiftKey: boolean, handle: ResizeHandle) => void;
  onSnapToCellsToggle?: (enabled: boolean) => void;
  onReset: () => void;
  onMinimize: () => void;
  onMaximize?: () => void;
  onClose: () => void;
  onInteractionEnd?: () => void;
}

export function Frame({
  child,
  isSelected,
  zoom,
  viewport$,
  onMove,
  onResize,
  onSnapToCellsToggle,
  onReset,
  onMinimize,
  onMaximize,
  onClose,
  onInteractionEnd
}: FrameProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<ResizeHandle | null>(null);
  const [isHoveringHandle, setIsHoveringHandle] = useState<ResizeHandle | null>(null);
  const [isHoveringFrame, setIsHoveringFrame] = useState(false);
  const titleBarRef = useRef<HTMLDivElement | null>(null);
  const onMoveRef = useRef(onMove);
  const onResizeRef = useRef(onResize);
  const onInteractionEndRef = useRef(onInteractionEnd);
  const dragStartRef = useRef({
    x: 0,
    y: 0,
    viewportX: 0,
    viewportY: 0,
    viewportZoom: 1,
    interactionScale: 1
  });
  const resizeStartRef = useRef({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    viewportX: 0,
    viewportY: 0,
    viewportZoom: 1,
    interactionScale: 1
  });

  useEffect(() => {
    onMoveRef.current = onMove;
    onResizeRef.current = onResize;
    onInteractionEndRef.current = onInteractionEnd;
  }, [onMove, onResize, onInteractionEnd]);

  const getInteractionScale = useCallback(() => {
    const renderedWidth = titleBarRef.current?.getBoundingClientRect().width;

    if (!renderedWidth || !Number.isFinite(renderedWidth) || child.width <= 0) {
      return zoom;
    }

    return renderedWidth / child.width;
  }, [child.width, zoom]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isSelected) return;

      const viewport = viewport$.currentViewport;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        viewportX: viewport.x,
        viewportY: viewport.y,
        viewportZoom: viewport.zoom,
        interactionScale: getInteractionScale()
      };
    },
    [getInteractionScale, isSelected, viewport$]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, handle: ResizeHandle) => {
      if (!isSelected) return;

      const viewport = viewport$.currentViewport;
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(handle);
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: child.width,
        height: child.height,
        viewportX: viewport.x,
        viewportY: viewport.y,
        viewportZoom: viewport.zoom,
        interactionScale: getInteractionScale()
      };
    },
    [getInteractionScale, isSelected, child.width, child.height, viewport$]
  );

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const viewport = viewport$.currentViewport;
      if (isDragging) {
        // Calculate mouse movement delta
        const mouseDeltaX = (e.clientX - dragStartRef.current.x) / dragStartRef.current.interactionScale;
        const mouseDeltaY = (e.clientY - dragStartRef.current.y) / dragStartRef.current.interactionScale;

        // Calculate viewport movement delta since drag started
        const viewportDeltaX = (viewport.x - dragStartRef.current.viewportX) / viewport.zoom;
        const viewportDeltaY = (viewport.y - dragStartRef.current.viewportY) / viewport.zoom;

        // Total movement is mouse movement minus viewport movement (to counteract viewport panning)
        const totalDeltaX = mouseDeltaX - viewportDeltaX;
        const totalDeltaY = mouseDeltaY - viewportDeltaY;

        onMoveRef.current(totalDeltaX, totalDeltaY);
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          viewportX: viewport.x,
          viewportY: viewport.y,
          viewportZoom: viewport.zoom,
          interactionScale: dragStartRef.current.interactionScale
        };
      } else if (isResizing) {
        // Calculate mouse movement delta for resize
        const mouseDeltaX = (e.clientX - resizeStartRef.current.x) / resizeStartRef.current.interactionScale;
        const mouseDeltaY = (e.clientY - resizeStartRef.current.y) / resizeStartRef.current.interactionScale;

        // Calculate viewport movement delta since resize started
        const viewportDeltaX = (viewport.x - resizeStartRef.current.viewportX) / zoom;
        const viewportDeltaY = (viewport.y - resizeStartRef.current.viewportY) / zoom;

        // Total movement for resize handle
        const totalDeltaX = mouseDeltaX - viewportDeltaX;
        const totalDeltaY = mouseDeltaY - viewportDeltaY;

        let deltaWidth = 0;
        let deltaHeight = 0;

        switch (isResizing) {
          case 'right':
            deltaWidth = totalDeltaX;
            break;
          case 'left':
            deltaWidth = -totalDeltaX;
            break;
          case 'bottom':
            deltaHeight = totalDeltaY;
            break;
          case 'top':
            deltaHeight = -totalDeltaY;
            break;
          case 'bottom-right':
            deltaWidth = totalDeltaX;
            deltaHeight = totalDeltaY;
            break;
          case 'bottom-left':
            deltaWidth = -totalDeltaX;
            deltaHeight = totalDeltaY;
            break;
          case 'top-right':
            deltaWidth = totalDeltaX;
            deltaHeight = -totalDeltaY;
            break;
          case 'top-left':
            deltaWidth = -totalDeltaX;
            deltaHeight = -totalDeltaY;
            break;
        }

        onResizeRef.current(deltaWidth, deltaHeight, e.shiftKey, isResizing);
        resizeStartRef.current.x = e.clientX;
        resizeStartRef.current.y = e.clientY;
        resizeStartRef.current.viewportX = viewport.x;
        resizeStartRef.current.viewportY = viewport.y;
        resizeStartRef.current.viewportZoom = viewport.zoom;
      }
    };

    const handleViewportChange = (newViewport: { x: number; y: number; zoom: number }) => {
      if (isDragging) {
        // Only apply movement corrections if zoom hasn't changed (indicating actual panning, not zoom-induced position change)
        const zoomChanged = newViewport.zoom !== dragStartRef.current.viewportZoom;

        if (!zoomChanged) {
          // Calculate viewport movement delta since drag started
          const viewportDeltaX = (newViewport.x - dragStartRef.current.viewportX) / newViewport.zoom;
          const viewportDeltaY = (newViewport.y - dragStartRef.current.viewportY) / newViewport.zoom;

          // Apply viewport movement as counter-movement to maintain relative position
          onMoveRef.current(-viewportDeltaX, -viewportDeltaY);
        }

        // Always update stored viewport position for next comparison
        dragStartRef.current.viewportX = newViewport.x;
        dragStartRef.current.viewportY = newViewport.y;
        dragStartRef.current.viewportZoom = newViewport.zoom;
      } else if (isResizing) {
        // For resizing, also only respond to actual panning, not zoom changes
        const zoomChanged = newViewport.zoom !== resizeStartRef.current.viewportZoom;

        if (!zoomChanged) {
          // Calculate viewport movement delta since resize started
          const viewportDeltaX = (newViewport.x - resizeStartRef.current.viewportX) / newViewport.zoom;
          const viewportDeltaY = (newViewport.y - resizeStartRef.current.viewportY) / newViewport.zoom;

          // Apply viewport movement as resize adjustments based on the active handle
          let deltaWidth = 0;
          let deltaHeight = 0;

          switch (isResizing) {
            case 'right':
              deltaWidth = -viewportDeltaX;
              break;
            case 'left':
              deltaWidth = viewportDeltaX;
              break;
            case 'bottom':
              deltaHeight = -viewportDeltaY;
              break;
            case 'top':
              deltaHeight = viewportDeltaY;
              break;
            case 'bottom-right':
              deltaWidth = -viewportDeltaX;
              deltaHeight = -viewportDeltaY;
              break;
            case 'bottom-left':
              deltaWidth = viewportDeltaX;
              deltaHeight = -viewportDeltaY;
              break;
            case 'top-right':
              deltaWidth = -viewportDeltaX;
              deltaHeight = viewportDeltaY;
              break;
            case 'top-left':
              deltaWidth = viewportDeltaX;
              deltaHeight = viewportDeltaY;
              break;
          }

          // Apply the resize adjustment to counteract viewport panning
          if (deltaWidth !== 0 || deltaHeight !== 0) {
            onResizeRef.current(deltaWidth, deltaHeight, false, isResizing);
          }
        }

        // Always update stored viewport position
        resizeStartRef.current.viewportX = newViewport.x;
        resizeStartRef.current.viewportY = newViewport.y;
        resizeStartRef.current.viewportZoom = newViewport.zoom;
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(null);
      onInteractionEndRef.current?.();
    };

    // Subscribe to viewport changes
    const unsubscribe = viewport$.subscribe(handleViewportChange);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      unsubscribe();
    };
  }, [isDragging, isResizing, zoom, viewport$]);

  const isTextBox = child.component === 'RichText';
  const isSnappedToCells = Boolean(child.snapToCells);

  // Text boxes use an Excel-style selected border instead of a window title bar.
  if (!isSelected && (!child.minimized || isTextBox)) return null;

  const handleSize = 4;
  const textBoxHandleSize = 8;
  const textBoxEdgeSize = 8;
  const titleBarHeight = 32;

  const getResizeHandleStyle = (
    handle: ResizeHandle,
    baseStyle: React.CSSProperties
  ): React.CSSProperties => ({
    ...baseStyle,
    background:
      isHoveringHandle === handle || isResizing === handle
        ? 'rgba(102, 126, 234, 1)'
        : 'rgba(102, 126, 234, 0.4)',
    transition: 'all 0.2s ease-in-out',
    opacity: 1,
    // transform: isHoveringHandle === handle || isResizing === handle ? "scale(1.1)" : "scale(1)",
    zIndex: isHoveringHandle === handle || isResizing === handle ? 30 : handle.includes('-') ? 20 : 10
  });

  const getTextBoxResizeHandleStyle = (
    handle: ResizeHandle,
    baseStyle: React.CSSProperties
  ): React.CSSProperties => ({
    ...baseStyle,
    position: 'absolute',
    width: textBoxHandleSize,
    height: textBoxHandleSize,
    boxSizing: 'border-box',
    border: '1px solid #1a73e8',
    background: isHoveringHandle === handle || isResizing === handle ? '#e8f0fe' : '#ffffff',
    borderRadius: 1,
    pointerEvents: 'auto',
    zIndex: 30
  });

  const getTextBoxDragEdgeStyle = (baseStyle: React.CSSProperties): React.CSSProperties => ({
    ...baseStyle,
    position: 'absolute',
    background: 'transparent',
    cursor: isDragging ? 'grabbing' : 'move',
    pointerEvents: 'auto',
    zIndex: 20
  });

  if (isTextBox) {
    return (
      <div
        ref={titleBarRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          border: '1px solid #1a73e8',
          boxSizing: 'border-box',
          zIndex: 20
        }}
      >
        {onSnapToCellsToggle && (
          <button
            type="button"
            title={isSnappedToCells ? 'Disable cell snapping' : 'Snap to cells'}
            aria-pressed={isSnappedToCells}
            onMouseDown={(ev) => {
              ev.stopPropagation();
              ev.preventDefault();
            }}
            onMouseUp={(ev) => {
              ev.stopPropagation();
              ev.preventDefault();
            }}
            onClick={(e) => {
              console.log('123');
              e.preventDefault();
              e.stopPropagation();
              onSnapToCellsToggle(!isSnappedToCells);
            }}
            style={{
              position: 'absolute',
              top: -30,
              right: 0,
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              border: '1px solid #1a73e8',
              borderRadius: 4,
              background: isSnappedToCells ? '#e8f0fe' : '#ffffff',
              color: '#1a73e8',
              cursor: 'pointer',
              pointerEvents: 'auto',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
              zIndex: 40
            }}
          >
            {isSnappedToCells ? <GridOnIcon size={16} /> : <GridOffIcon size={16} />}
          </button>
        )}
        {child.canClose && (
          <button
            type="button"
            title="Delete text box"
            onMouseDown={(ev) => {
              ev.stopPropagation();
              ev.preventDefault();
            }}
            onMouseUp={(ev) => {
              ev.stopPropagation();
              ev.preventDefault();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            style={{
              position: 'absolute',
              top: -30,
              right: onSnapToCellsToggle ? 30 : 0,
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              border: '1px solid #d93025',
              borderRadius: 4,
              background: '#ffffff',
              color: '#d93025',
              cursor: 'pointer',
              pointerEvents: 'auto',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
              zIndex: 40
            }}
          >
            <DeleteIcon size={16} />
          </button>
        )}
        <div
          style={getTextBoxDragEdgeStyle({
            top: -textBoxEdgeSize / 2,
            left: textBoxHandleSize,
            right: textBoxHandleSize,
            height: textBoxEdgeSize
          })}
          onMouseDown={handleMouseDown}
        />
        <div
          style={getTextBoxDragEdgeStyle({
            bottom: -textBoxEdgeSize / 2,
            left: textBoxHandleSize,
            right: textBoxHandleSize,
            height: textBoxEdgeSize
          })}
          onMouseDown={handleMouseDown}
        />
        <div
          style={getTextBoxDragEdgeStyle({
            top: textBoxHandleSize,
            bottom: textBoxHandleSize,
            left: -textBoxEdgeSize / 2,
            width: textBoxEdgeSize
          })}
          onMouseDown={handleMouseDown}
        />
        <div
          style={getTextBoxDragEdgeStyle({
            top: textBoxHandleSize,
            bottom: textBoxHandleSize,
            right: -textBoxEdgeSize / 2,
            width: textBoxEdgeSize
          })}
          onMouseDown={handleMouseDown}
        />

        <div
          style={getTextBoxResizeHandleStyle('top-left', {
            top: -textBoxHandleSize / 2,
            left: -textBoxHandleSize / 2,
            cursor: 'nw-resize'
          })}
          onMouseDown={(e) => handleResizeMouseDown(e, 'top-left')}
          onMouseEnter={() => setIsHoveringHandle('top-left')}
          onMouseLeave={() => setIsHoveringHandle(null)}
        />
        <div
          style={getTextBoxResizeHandleStyle('top', {
            top: -textBoxHandleSize / 2,
            left: '50%',
            marginLeft: -textBoxHandleSize / 2,
            cursor: 'n-resize'
          })}
          onMouseDown={(e) => handleResizeMouseDown(e, 'top')}
          onMouseEnter={() => setIsHoveringHandle('top')}
          onMouseLeave={() => setIsHoveringHandle(null)}
        />
        <div
          style={getTextBoxResizeHandleStyle('top-right', {
            top: -textBoxHandleSize / 2,
            right: -textBoxHandleSize / 2,
            cursor: 'ne-resize'
          })}
          onMouseDown={(e) => handleResizeMouseDown(e, 'top-right')}
          onMouseEnter={() => setIsHoveringHandle('top-right')}
          onMouseLeave={() => setIsHoveringHandle(null)}
        />
        <div
          style={getTextBoxResizeHandleStyle('right', {
            top: '50%',
            right: -textBoxHandleSize / 2,
            marginTop: -textBoxHandleSize / 2,
            cursor: 'e-resize'
          })}
          onMouseDown={(e) => handleResizeMouseDown(e, 'right')}
          onMouseEnter={() => setIsHoveringHandle('right')}
          onMouseLeave={() => setIsHoveringHandle(null)}
        />
        <div
          style={getTextBoxResizeHandleStyle('bottom-right', {
            bottom: -textBoxHandleSize / 2,
            right: -textBoxHandleSize / 2,
            cursor: 'se-resize'
          })}
          onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-right')}
          onMouseEnter={() => setIsHoveringHandle('bottom-right')}
          onMouseLeave={() => setIsHoveringHandle(null)}
        />
        <div
          style={getTextBoxResizeHandleStyle('bottom', {
            bottom: -textBoxHandleSize / 2,
            left: '50%',
            marginLeft: -textBoxHandleSize / 2,
            cursor: 's-resize'
          })}
          onMouseDown={(e) => handleResizeMouseDown(e, 'bottom')}
          onMouseEnter={() => setIsHoveringHandle('bottom')}
          onMouseLeave={() => setIsHoveringHandle(null)}
        />
        <div
          style={getTextBoxResizeHandleStyle('bottom-left', {
            bottom: -textBoxHandleSize / 2,
            left: -textBoxHandleSize / 2,
            cursor: 'sw-resize'
          })}
          onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-left')}
          onMouseEnter={() => setIsHoveringHandle('bottom-left')}
          onMouseLeave={() => setIsHoveringHandle(null)}
        />
        <div
          style={getTextBoxResizeHandleStyle('left', {
            top: '50%',
            left: -textBoxHandleSize / 2,
            marginTop: -textBoxHandleSize / 2,
            cursor: 'w-resize'
          })}
          onMouseDown={(e) => handleResizeMouseDown(e, 'left')}
          onMouseEnter={() => setIsHoveringHandle('left')}
          onMouseLeave={() => setIsHoveringHandle(null)}
        />
      </div>
    );
  }

  return (
    <>
      {/* Title bar with modern glass morphism effect */}
      <div
        ref={titleBarRef}
        style={{
          position: 'absolute',
          top: -titleBarHeight,
          left: 0,
          right: 0,
          height: titleBarHeight,
          background:
            child.minimized && !isSelected
              ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95) 0%, rgba(75, 85, 99, 0.95) 100%)'
              : 'linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderBottom: '1px solid rgba(102, 126, 234, 0.4)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          fontSize: '13px',
          fontWeight: 600,
          letterSpacing: '0.025em',
          opacity: child.minimized && !isSelected ? 0.9 : 1,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
        }}
        onMouseDown={handleMouseDown}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)'
          }}
        >
          {child.title}
        </span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              padding: '4px 8px',
              fontSize: '12px',
              fontWeight: '600',
              lineHeight: 1,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              backdropFilter: 'blur(8px)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
            title={child.minimized ? 'Restore' : 'Minimize'}
          >
            {child.minimized ? '□' : '−'}
          </button>
          {onMaximize && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMaximize();
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '6px',
                color: 'white',
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: '12px',
                fontWeight: '600',
                lineHeight: 1,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                backdropFilter: 'blur(8px)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              title={child.maximized ? 'Restore' : 'Maximize'}
            >
              {child.maximized ? '◱' : '⤢'}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '6px',
              color: 'white',
              cursor: child.initial ? 'pointer' : 'auto',
              padding: '4px 8px',
              fontSize: '12px',
              fontWeight: '600',
              lineHeight: 1,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              backdropFilter: 'blur(8px)',
              opacity: child.initial ? 1 : 0.2
            }}
            disabled={!child.initial}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
            title="Reset"
          >
            ↻
          </button>
          {child.canClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '6px',
                color: 'white',
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: '12px',
                fontWeight: '600',
                lineHeight: 1,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                backdropFilter: 'blur(8px)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              title="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Resize handles that integrate with the frame border */}
      {isSelected && !child.minimized && (
        <div
          onMouseEnter={() => !isResizing && !isDragging && setIsHoveringFrame(true)}
          onMouseLeave={() => !isResizing && !isDragging && setIsHoveringFrame(false)}
        >
          {/* Edge handles */}
          <div
            style={getResizeHandleStyle('top', {
              position: 'absolute',
              top: -titleBarHeight - handleSize,
              left: 0,
              right: 0,
              height: handleSize,
              cursor: 'n-resize'
            })}
            onMouseDown={(e) => handleResizeMouseDown(e, 'top')}
            onMouseEnter={() => setIsHoveringHandle('top')}
            onMouseLeave={() => setIsHoveringHandle(null)}
          />
          <div
            style={getResizeHandleStyle('bottom', {
              position: 'absolute',
              bottom: -handleSize,
              left: 0,
              right: 0,
              height: handleSize,
              cursor: 's-resize'
            })}
            onMouseDown={(e) => handleResizeMouseDown(e, 'bottom')}
            onMouseEnter={() => setIsHoveringHandle('bottom')}
            onMouseLeave={() => setIsHoveringHandle(null)}
          />
          <div
            style={getResizeHandleStyle('left', {
              position: 'absolute',
              top: -titleBarHeight,
              left: -handleSize,
              bottom: 0,
              width: handleSize,
              cursor: 'w-resize'
            })}
            onMouseDown={(e) => handleResizeMouseDown(e, 'left')}
            onMouseEnter={() => setIsHoveringHandle('left')}
            onMouseLeave={() => setIsHoveringHandle(null)}
          />
          <div
            style={getResizeHandleStyle('right', {
              position: 'absolute',
              top: -titleBarHeight,
              right: -handleSize,
              bottom: 0,
              width: handleSize,
              cursor: 'e-resize'
            })}
            onMouseDown={(e) => handleResizeMouseDown(e, 'right')}
            onMouseEnter={() => setIsHoveringHandle('right')}
            onMouseLeave={() => setIsHoveringHandle(null)}
          />

          {/* Corner handles - rendered on top */}
          <div
            style={getResizeHandleStyle('top-left', {
              position: 'absolute',
              top: -titleBarHeight - handleSize,
              left: -handleSize,
              width: handleSize,
              height: handleSize,
              cursor: 'nw-resize'
            })}
            onMouseDown={(e) => handleResizeMouseDown(e, 'top-left')}
            onMouseEnter={() => setIsHoveringHandle('top-left')}
            onMouseLeave={() => setIsHoveringHandle(null)}
          />
          <div
            style={getResizeHandleStyle('top-right', {
              position: 'absolute',
              top: -titleBarHeight - handleSize,
              right: -handleSize,
              width: handleSize,
              height: handleSize,
              cursor: 'ne-resize'
            })}
            onMouseDown={(e) => handleResizeMouseDown(e, 'top-right')}
            onMouseEnter={() => setIsHoveringHandle('top-right')}
            onMouseLeave={() => setIsHoveringHandle(null)}
          />
          <div
            style={getResizeHandleStyle('bottom-left', {
              position: 'absolute',
              bottom: -handleSize,
              left: -handleSize,
              width: handleSize,
              height: handleSize,
              cursor: 'sw-resize'
            })}
            onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-left')}
            onMouseEnter={() => setIsHoveringHandle('bottom-left')}
            onMouseLeave={() => setIsHoveringHandle(null)}
          />
          <div
            style={getResizeHandleStyle('bottom-right', {
              position: 'absolute',
              bottom: -handleSize,
              right: -handleSize,
              width: handleSize,
              height: handleSize,
              cursor: 'se-resize'
            })}
            onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-right')}
            onMouseEnter={() => setIsHoveringHandle('bottom-right')}
            onMouseLeave={() => setIsHoveringHandle(null)}
          />
        </div>
      )}
    </>
  );
}
