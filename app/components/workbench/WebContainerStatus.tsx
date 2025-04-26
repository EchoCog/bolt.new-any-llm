import React, { useEffect, useState } from 'react';
import { webcontainerContext } from '~/lib/webcontainer';

/**
 * Component to display the status of the WebContainer initialization
 * This helps users diagnose issues with the file manager
 */
export const WebContainerStatus: React.FC = () => {
  const [status, setStatus] = useState<{
    loaded: boolean;
    error?: string;
    fallbackEnabled?: boolean;
  }>({
    loaded: false,
    fallbackEnabled: false
  });

  useEffect(() => {
    // Initial status check
    setStatus({
      loaded: webcontainerContext.loaded,
      error: webcontainerContext.error,
      fallbackEnabled: webcontainerContext.fallbackEnabled
    });

    // Set up a periodic check for WebContainer status
    const intervalId = setInterval(() => {
      setStatus({
        loaded: webcontainerContext.loaded,
        error: webcontainerContext.error,
        fallbackEnabled: webcontainerContext.fallbackEnabled
      });

      // Once loaded successfully, stop checking
      if (webcontainerContext.loaded) {
        clearInterval(intervalId);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  // If WebContainer is loaded without fallback and no errors, don't show anything
  if (status.loaded && !status.error && !status.fallbackEnabled) {
    return null;
  }

  // If we're using fallback mode, show a temporary notification that disappears after 10 seconds
  if (status.loaded && status.fallbackEnabled) {
    return (
      <div style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        backgroundColor: '#FEF9C3', // Light yellow
        color: '#854D0E', // Amber text
        padding: '12px 16px',
        borderRadius: '8px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        zIndex: 9999,
        maxWidth: '400px',
        animation: 'fadeout 0.5s ease-in-out 10s forwards'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
          Limited File Manager Mode
        </div>
        <div style={{ fontSize: '14px' }}>
          Running in simplified file manager mode due to browser compatibility.
          Some features may be limited.
        </div>
        <style>{`
          @keyframes fadeout {
            from { opacity: 1; }
            to { opacity: 0; visibility: hidden; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      backgroundColor: status.error ? '#FEE2E2' : '#E0F2FE',
      color: status.error ? '#B91C1C' : '#0369A1',
      padding: '12px 16px',
      borderRadius: '8px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      zIndex: 9999,
      maxWidth: '400px'
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
        {status.error ? 'File Manager Notice' : 'Initializing File Manager...'}
      </div>
      <div style={{ fontSize: '14px' }}>
        {status.error ? (
          <>
            <div>{status.error}</div>
            <div style={{ marginTop: '8px', fontSize: '12px' }}>
              WebContainer requires a modern browser with secure context permissions.
              Limited functionality will be available.
            </div>
          </>
        ) : (
          'Setting up the file system. This may take a few moments...'
        )}
      </div>
    </div>
  );
};

export default WebContainerStatus;
