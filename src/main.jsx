import React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApolloProvider } from '@apollo/client';
import { Provider } from 'react-redux'; // Importing the Provider from react-redux
import App from './App';
import './index.css';
import client from './lib/apolloClient';
import store from '../src/redux/Store'; // Importing the Redux store (replace with your store file path)
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { Buffer } from 'buffer';
import { AppProviders } from './context/Providers';
window.Buffer = Buffer;

// import { Buffer } from 'buffer';
// window.Buffer = Buffer;

createRoot(document.getElementById('root')).render(

  <StrictMode>
    <BrowserRouter>
    <AppProviders>
      <ApolloProvider client={client}>
        <Provider store={store}> {/* Wrap the app with the Redux Provider */}
          <App />
          <ToastContainer className="custom-toast-body"/>
        </Provider>
      </ApolloProvider>
      </AppProviders>
    </BrowserRouter>
  </StrictMode>
);
