import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { setHiveAuthCallbacks } from '../hive-api/aioha';
import './HiveAuthWaiting.scss';

const HiveAuthContext = createContext(null);

export const HiveAuthProvider = ({ children }) => {
  const [isWaiting, setIsWaiting] = useState(false);
  const [waitingMessage, setWaitingMessage] = useState('');

  const showWaiting = useCallback((message = 'Waiting for approval on HiveAuth...') => {
    setWaitingMessage(message);
    setIsWaiting(true);
  }, []);

  const hideWaiting = useCallback(() => {
    setIsWaiting(false);
    setWaitingMessage('');
  }, []);

  // Register callbacks with aioha helper on mount
  useEffect(() => {
    setHiveAuthCallbacks(showWaiting, hideWaiting);

    return () => {
      setHiveAuthCallbacks(null, null);
    };
  }, [showWaiting, hideWaiting]);

  return (
    <HiveAuthContext.Provider value={{ isWaiting, waitingMessage, showWaiting, hideWaiting }}>
      {children}
      {/* Built-in waiting modal */}
      {isWaiting && (
        <div className="hiveauth-waiting-overlay">
          <div className="hiveauth-waiting-modal">
            <div className="hiveauth-spinner"></div>
            <h3>HiveAuth Approval Required</h3>
            <p>{waitingMessage}</p>
            <p className="hiveauth-hint">Please check your HiveAuth app to approve this transaction</p>
          </div>
        </div>
      )}
    </HiveAuthContext.Provider>
  );
};

export const useHiveAuth = () => {
  const context = useContext(HiveAuthContext);
  if (!context) {
    throw new Error('useHiveAuth must be used within a HiveAuthProvider');
  }
  return context;
};
