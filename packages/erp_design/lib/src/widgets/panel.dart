import 'package:flutter/material.dart';

import '../catalog/generated.dart' as g;
import '../format.dart';
import '../theme.dart';
import '../tokens.dart';

/// The root of a generated surface: title, children, source footer and
/// follow-up questions.
class PanelView extends StatelessWidget {
  const PanelView({super.key, required this.data, required this.children, this.onFollowUp});

  final g.Panel data;
  final List<Widget> children;
  final ValueChanged<String>? onFollowUp;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(header: true, child: Text(data.title, style: t.title)),
        if (data.subtitle != null) ...[const SizedBox(height: Space.x1), Text(data.subtitle!, style: t.bodySecondary)],
        const SizedBox(height: Space.x4),
        for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(height: Space.x4), children[i]],
        if (data.source?.isNotEmpty ?? false) ...[const SizedBox(height: Space.x3), SourceFooter(data.source!)],
        if ((data.followUps?.isNotEmpty ?? false) && onFollowUp != null) ...[
          const SizedBox(height: Space.x4),
          Wrap(
            spacing: Space.x2,
            runSpacing: Space.x2,
            children: [for (final q in data.followUps!.take(3)) FollowUpChip(q, onTap: () => onFollowUp!(q))],
          ),
        ],
      ],
    );
  }
}

class SourceFooter extends StatelessWidget {
  const SourceFooter(this.sources, {super.key});

  final List<g.Source> sources;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    final tables = {for (final s in sources) ...s.tables}.join(', ');
    final filters = {
      for (final s in sources)
        for (final e in s.filters.entries) '${e.key}: ${e.value}',
    }.join(' · ');
    final at = sources.map((s) => s.at).reduce((a, b) => a.compareTo(b) > 0 ? a : b);
    return Semantics(
      label: 'Source',
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: 'Source  ',
              style: t.caption.copyWith(fontWeight: FontWeight.w500, color: context.colors.textSecondary),
            ),
            TextSpan(text: tables),
            if (filters.isNotEmpty) TextSpan(text: '  ·  $filters'),
            TextSpan(text: '  ·  as of ${Fmt.dateTime(at)} UTC'),
          ],
        ),
        style: t.caption,
      ),
    );
  }
}

class FollowUpChip extends StatefulWidget {
  const FollowUpChip(this.text, {super.key, required this.onTap});
  final String text;
  final VoidCallback onTap;

  @override
  State<FollowUpChip> createState() => _FollowUpChipState();
}

class _FollowUpChipState extends State<FollowUpChip> {
  bool _focus = false;
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return FocusableActionDetector(
      mouseCursor: SystemMouseCursors.click,
      onShowFocusHighlight: (v) => setState(() => _focus = v),
      onShowHoverHighlight: (v) => setState(() => _hover = v),
      actions: {ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) => widget.onTap())},
      child: GestureDetector(
        onTap: widget.onTap,
        child: Semantics(
          button: true,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: Space.x3, vertical: Space.x1 + 2),
            decoration: BoxDecoration(
              color: _hover ? c.surfaceSunken : c.surface,
              borderRadius: Radii.control,
              border: Border.all(color: _focus ? c.accent : c.border, width: _focus ? 2 : 1),
            ),
            child: Text(widget.text, style: context.type.body.copyWith(color: c.textSecondary)),
          ),
        ),
      ),
    );
  }
}
