import React, { useEffect, useState } from 'react';
import { webcontainer, webcontainerContext } from '~/lib/webcontainer';

/**
 * Component to display the status of the WebContainer initialization
 * This helps users diagnose issues with the file manager
 */
export const WebContainerStatus: React.FC = () => {
  const [status, setStatus] = useState<{
    loaded: boolean;
    error?: string;
    fallbackEnabled?: boolean;
    initializing?: boolean;
    retryCount: number;
  }>({
    loaded: false,
    fallbackEnabled: false,
    initializing: true,
    retryCount: 0
  });

  const handleRetry = () => {
    // Force reload the page to reinitialize WebContainer
    window.location.reload();
  };

  useEffect(() => {
    // Initial status check
    setStatus({
      loaded: webcontainerContext.loaded,
      error: webcontainerContext.error,
      fallbackEnabled: webcontainerContext.fallbackEnabled,
      initializing: webcontainerContext.initializing || false,
      retryCount: status.retryCount
    });

    // Set up a periodic check for WebContainer status
    const intervalId = setInterval(() => {
      setStatus(prevStatus => ({
        loaded: webcontainerContext.loaded,
        error: webcontainerContext.error,
        fallbackEnabled: webcontainerContext.fallbackEnabled,
        initializing: webcontainerContext.initializing || false,
        retryCount: prevStatus.retryCount
      }));

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
        {status.error
          ? 'File Manager Issues Detected'
          : status.initializing
            ? 'Initializing File Manager...'
            : 'Waiting for File Manager...'}
      </div>
      <div style={{ fontSize: '14px' }}>
        {status.error ? (
          <>
            <div>{status.error}</div>
            <div style={{ marginTop: '8px', fontSize: '12px' }}>
              WebContainer requires a modern browser with secure context permissions.
              Try using Google Chrome Canary or Edge for best results.
            </div>
            <button
              onClick={handleRetry}
              style={{
                marginTop: '10px',
                padding: '4px 10px',
                backgroundColor: '#DC2626',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Retry File System
            </button>
          </>
        ) : (
          <div>
            Setting up the file system. This may take a few moments...
            {status.initializing && (
              <div
                style={{
                  display: 'inline-block',
                  marginLeft: '10px',
                  width: '14px',
                  height: '14px',
                  border: '2px solid rgba(3, 105, 161, 0.3)',
                  borderTopColor: '#0369A1',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}
              />
            )}
            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
};

export default WebContainerStatus;
