import 'package:erp_design/erp_design.dart';
import 'package:flutter/material.dart';
import 'package:genui/genui.dart';

import '../agent/conversation.dart';

/// One question, the live status line, skeletons while waiting, and the
/// surfaces the server sent.
class TurnView extends StatelessWidget {
  const TurnView({super.key, required this.turn, required this.controller});

  final Turn turn;
  final SurfaceController controller;

  Widget _skeleton(String component) => switch (component) {
        'KpiStrip' => const KpiStripSkeleton(),
        'DataTable' => const DataTableSkeleton(),
        'TrendChart' || 'BreakdownBar' => const ChartSkeleton(),
        _ => const RecordSkeleton(),
      };

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    final c = context.colors;
    final waiting = turn.surfaces.isEmpty && !turn.done;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.only(top: 2, right: Space.x2),
          child: Icon(Icons.subdirectory_arrow_right, size: 16, color: c.textMuted),
        ),
        Expanded(child: SelectableText(turn.question, style: t.bodyStrong)),
      ]),
      const SizedBox(height: Space.x3),
      if (turn.status != null) ...[
        StatusLineView(turn.status!),
        const SizedBox(height: Space.x3),
      ],
      for (final note in turn.notes) ...[
        Text(note, style: t.bodySecondary),
        const SizedBox(height: Space.x3),
      ],
      if (waiting)
        for (final shape in turn.pending) ...[_skeleton(shape), const SizedBox(height: Space.x4)],
      for (final id in turn.surfaces) ...[
        Surface(key: ValueKey(id), surfaceContext: controller.contextFor(id)),
        const SizedBox(height: Space.x4),
      ],
      if (turn.done && turn.surfaces.isEmpty && turn.notes.isEmpty)
        NoticeView(Notice.fromJson({
          'tone': 'warning',
          'title': 'No answer came back',
          'body': 'The server finished without sending anything to show.',
          'nextStep': 'Ask again, or rephrase the question more narrowly.',
        })),
    ]);
  }
}

/// The server's current step, such as "Reading orders". A static dot, not a spinner.
class StatusLineView extends StatelessWidget {
  const StatusLineView(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
        liveRegion: true,
        child: Row(children: [
          Container(width: 6, height: 6, decoration: BoxDecoration(color: context.colors.accent, shape: BoxShape.circle)),
          const SizedBox(width: Space.x2),
          Text(text, style: context.type.caption.copyWith(color: context.colors.textSecondary)),
        ]),
      );
}
