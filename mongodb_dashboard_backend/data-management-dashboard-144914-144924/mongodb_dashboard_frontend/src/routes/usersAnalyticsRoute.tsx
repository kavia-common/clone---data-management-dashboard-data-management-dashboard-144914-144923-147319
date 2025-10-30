import React from 'react';
import { Route } from 'react-router-dom';
import UsersAnalyticsPanel from '../modules/users/analytics/UsersAnalyticsPanel';

// PUBLIC_INTERFACE
// Provides a route element for Users Analytics. Usage: include in your routes switch.
export const UsersAnalyticsRoute = <Route path="/users/analytics" element={<UsersAnalyticsPanel />} />;
