import React from 'react';
import { motion } from 'motion/react';

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

interface FadeSectionProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export const FadeSection: React.FC<FadeSectionProps> = ({
  children,
  className = '',
  delay = 0,
}) => (
  <motion.section
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.26, delay, ease: EASE_OUT_EXPO }}
    className={className}
  >
    {children}
  </motion.section>
);

interface StaggerCardProps {
  children: React.ReactNode;
  index?: number;
  className?: string;
  hoverLift?: boolean;
}

export const StaggerCard: React.FC<StaggerCardProps> = ({
  children,
  index = 0,
  className = '',
  hoverLift = true,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{
      duration: 0.24,
      delay: Math.min(index, 8) * 0.035,
      ease: EASE_OUT_EXPO,
    }}
    whileHover={
      hoverLift
        ? {
            y: -2,
            transition: { duration: 0.16, ease: EASE_OUT_EXPO },
          }
        : undefined
    }
    className={className}
  >
    {children}
  </motion.div>
);
