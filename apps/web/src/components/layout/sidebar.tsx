'use client';

import { clsx } from 'clsx';
import { Navigation } from './navigation';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {/* Overlay for mobile */}
      <div
        className={clsx(
          'fixed inset-0 z-40 lg:hidden',
          open ? 'block' : 'hidden'
        )}
      >
        <div
          className="fixed inset-0 bg-black opacity-25"
          onClick={onClose}
        />
        <nav className="relative flex flex-col w-full max-w-xs pt-5 pb-4 bg-card">
          <div className="absolute top-0 right-0 -mr-12 pt-2">
            <button
              type="button"
              className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
              onClick={onClose}
            >
              <span className="sr-only">Close sidebar</span>
              <XMarkIcon className="h-6 w-6 text-white" />
            </button>
          </div>
          <div className="flex items-center flex-shrink-0 px-4">
            <div className="flex items-center">
              <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">
                  FG
                </span>
              </div>
              <h2 className="ml-3 text-lg font-semibold text-foreground">
                FlakeGuard
              </h2>
            </div>
          </div>
          <div className="mt-5 flex-1 h-0 overflow-y-auto px-3">
            <Navigation />
          </div>
        </nav>
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <div className="flex flex-col w-64">
          <div className="flex flex-col h-0 flex-1 bg-card border-r border-border">
            <div className="flex items-center h-16 flex-shrink-0 px-4 bg-card border-b border-border">
              <div className="flex items-center">
                <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-sm">
                    FG
                  </span>
                </div>
                <h2 className="ml-3 text-lg font-semibold text-foreground">
                  FlakeGuard
                </h2>
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-y-auto pt-5 pb-4">
              <div className="flex-1 px-3 space-y-1">
                <Navigation />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
