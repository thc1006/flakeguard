import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // Main documentation sidebar
  mainSidebar: [
    'index',
    {
      type: 'category',
      label: 'Getting Started',
      collapsible: true,
      collapsed: false,
      items: [
        'getting-started/introduction',
        'getting-started/quick-start',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      collapsible: true,
      collapsed: false,
      items: [
        'concepts/flaky-tests',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      collapsible: true,
      collapsed: true,
      items: [
        'architecture/overview',
        'architecture/sequence-diagrams',
      ],
    },
    {
      type: 'category',
      label: 'Security',
      collapsible: true,
      collapsed: true,
      items: [
        'security/security-model',
      ],
    },
    {
      type: 'category',
      label: 'Monitoring & Observability',
      collapsible: true,
      collapsed: true,
      items: [
        'monitoring/slos-dora',
      ],
    },
    {
      type: 'category',
      label: 'Troubleshooting',
      collapsible: true,
      collapsed: true,
      items: [
        'troubleshooting/common-issues',
      ],
    },
  ],
  
  // API Reference sidebar
  apiSidebar: [
    {
      type: 'category',
      label: 'API Overview',
      collapsible: false,
      items: [
        'api/introduction',
      ],
    },
  ],
  
  // Architecture sidebar (for standalone architecture section)
  architectureSidebar: [
    'architecture/overview',
    'architecture/sequence-diagrams',
  ],
};

export default sidebars;