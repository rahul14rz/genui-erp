import 'package:flutter/material.dart';

import '../theme.dart';
import '../tokens.dart';

/// A bordered surface. Depth comes from the 1px border, not a shadow.
class ErpSurface extends StatelessWidget {
  const ErpSurface({super.key, required this.child, this.padding = const EdgeInsets.all(Space.x4), this.color});

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color ?? c.surface,
        borderRadius: Radii.surface,
        border: Border.all(color: c.border),
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}

enum Tone { neutral, info, success, warning, danger }

extension ToneColors on Tone {
  (Color fg, Color bg) colors(BuildContext context) {
    final c = context.colors;
    return switch (this) {
      Tone.neutral => (c.textSecondary, c.surfaceSunken),
      Tone.info => (c.accent, c.accentSubtle),
      Tone.success => (c.success, c.successBg),
      Tone.warning => (c.warning, c.warningBg),
      Tone.danger => (c.danger, c.dangerBg),
    };
  }
}

const _statusTones = <String, Tone>{
  'delivered': Tone.success,
  'paid': Tone.success,
  'ok': Tone.success,
  'approved': Tone.success,
  'received': Tone.success,
  'accepted': Tone.success,
  'dispatched': Tone.info,
  'confirmed': Tone.info,
  'open': Tone.info,
  'sent': Tone.info,
  'queued': Tone.warning,
  'picking': Tone.warning,
  'packed': Tone.warning,
  'partial': Tone.warning,
  'pending': Tone.warning,
  'low': Tone.warning,
  'draft': Tone.neutral,
  'cancelled': Tone.danger,
  'rejected': Tone.danger,
  'out': Tone.danger,
  'overdue': Tone.danger,
  'expired': Tone.danger,
  'void': Tone.danger,
};

Tone toneForStatus(String status) => _statusTones[status.toLowerCase()] ?? Tone.neutral;

/// Small all-caps status label. The only place all caps is used.
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key, this.tone});

  final String status;
  final Tone? tone;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = (tone ?? toneForStatus(status)).colors(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: Radii.control),
      child: Text(
        status.replaceAll('_', ' ').toUpperCase(),
        style: context.type.statusLabel.copyWith(color: fg),
        maxLines: 1,
        softWrap: false,
      ),
    );
  }
}

enum ButtonKind { primary, secondary, quiet }

/// A button with a visible focus ring for keyboard users.
class ErpButton extends StatefulWidget {
  const ErpButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.kind = ButtonKind.secondary,
    this.busy = false,
    this.icon,
    this.dense = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final ButtonKind kind;
  final bool busy;
  final IconData? icon;
  final bool dense;

  @override
  State<ErpButton> createState() => _ErpButtonState();
}

class _ErpButtonState extends State<ErpButton> {
  bool _focused = false;
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final enabled = widget.onPressed != null && !widget.busy;
    final (bg, fg, border) = switch (widget.kind) {
      ButtonKind.primary => (_hovered && enabled ? c.accentHover : c.accent, c.onAccent, Colors.transparent),
      ButtonKind.secondary => (_hovered && enabled ? c.surfaceSunken : c.surface, c.text, c.borderStrong),
      ButtonKind.quiet => (_hovered && enabled ? c.surfaceSunken : Colors.transparent, c.accent, Colors.transparent),
    };
    final style = context.type.bodyStrong.copyWith(color: fg);
    return FocusableActionDetector(
      enabled: enabled,
      mouseCursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onShowFocusHighlight: (v) => setState(() => _focused = v),
      onShowHoverHighlight: (v) => setState(() => _hovered = v),
      actions: {ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) => widget.onPressed?.call())},
      child: GestureDetector(
        onTap: enabled ? widget.onPressed : null,
        child: Semantics(
          button: true,
          enabled: enabled,
          label: widget.label,
          excludeSemantics: true,
          child: AnimatedOpacity(
            duration: Motion.of(context),
            opacity: enabled ? 1 : 0.5,
            child: Container(
              height: widget.dense ? 28 : 36,
              padding: EdgeInsets.symmetric(horizontal: widget.dense ? Space.x2 : Space.x3),
              decoration: BoxDecoration(
                color: bg,
                borderRadius: Radii.control,
                border: Border.all(color: _focused ? c.accent : border, width: _focused ? 2 : 1),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (widget.busy)
                    Padding(
                      padding: const EdgeInsets.only(right: Space.x2),
                      child: SizedBox.square(
                        dimension: 12,
                        child: CircularProgressIndicator(strokeWidth: 1.5, color: fg),
                      ),
                    )
                  else if (widget.icon != null)
                    Padding(
                      padding: const EdgeInsets.only(right: Space.x1 + 2),
                      child: Icon(widget.icon, size: 16, color: fg),
                    ),
                  Text(widget.label, style: style),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A static placeholder block. Skeletons take the shape of the component that
/// is about to arrive.
class SkeletonBlock extends StatelessWidget {
  const SkeletonBlock({super.key, this.width, required this.height, this.radius = Radii.control});

  final double? width;
  final double height;
  final BorderRadius radius;

  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: height,
    decoration: BoxDecoration(color: context.colors.surfaceSunken, borderRadius: radius),
  );
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Space.x3),
    child: Text(text, style: context.type.heading),
  );
}
