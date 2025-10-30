import React from 'react';
import Overview from '../Overview';

/**
 * PUBLIC_INTERFACE
 * Wrapper to reuse new Overview within existing dashboard namespace if needed.
 * Adds on-brown for accessible focus outlines within brown card context.
 */
export default function OverviewWrapper() {
  return <div className="on-brown"><Overview /></div>;
}
