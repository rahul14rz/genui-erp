import 'package:flutter/material.dart';

import '../catalog/generated.dart' as g;
import '../format.dart';
import '../theme.dart';
import '../tokens.dart';
import 'primitives.dart';

class FieldValue extends StatelessWidget {
  const FieldValue({super.key, required this.label, required this.type, required this.value});

  final String label;
  final g.CellType type;
  final Object? value;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    final style = switch (type) {
      g.CellType.mono => t.mono,
      g.CellType.money || g.CellType.number || g.CellType.percent => t.numeric,
      _ => t.body,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: t.caption.copyWith(color: context.colors.textSecondary)),
        const SizedBox(height: 2),
        if (type == g.CellType.status && value != null)
          StatusBadge('$value')
        else
          Text(value == null ? 'Not set' : Fmt.cell(type, value), style: value == null ? t.caption : style),
      ],
    );
  }
}

class RecordCardView extends StatelessWidget {
  const RecordCardView(this.data, {super.key, this.onLink});

  final g.RecordCard data;
  final ValueChanged<String>? onLink;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    return ErpSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(data.title, style: t.heading),
                    if (data.subtitle != null) Text(data.subtitle!, style: t.bodySecondary),
                  ],
                ),
              ),
              if (data.status != null) StatusBadge(data.status!),
            ],
          ),
          const SizedBox(height: Space.x4),
          LayoutBuilder(
            builder: (context, box) {
              final cols = box.maxWidth < Breakpoints.phone
                  ? 1
                  : box.maxWidth < 760
                  ? 2
                  : 3;
              final w = (box.maxWidth - Space.x6 * (cols - 1)) / cols;
              return Wrap(
                spacing: Space.x6,
                runSpacing: Space.x4,
                children: [
                  for (final f in data.fields)
                    SizedBox(
                      width: w,
                      child: FieldValue(label: f.label, type: f.type, value: f.value),
                    ),
                ],
              );
            },
          ),
          if ((data.links?.isNotEmpty ?? false) && onLink != null) ...[
            const SizedBox(height: Space.x4),
            Wrap(
              spacing: Space.x2,
              runSpacing: Space.x2,
              children: [
                for (final l in data.links!)
                  ErpButton(label: l.label, kind: ButtonKind.quiet, dense: true, onPressed: () => onLink!(l.question)),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class TimelineView extends StatelessWidget {
  const TimelineView(this.data, {super.key});

  final g.Timeline data;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = context.type;
    final rows = data.rows;
    return ErpSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (data.title != null) SectionTitle(data.title!),
          if (rows.isEmpty) Text('No status changes recorded yet.', style: t.bodySecondary),
          for (var i = 0; i < rows.length; i++)
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    width: 16,
                    child: Column(
                      children: [
                        const SizedBox(height: 6),
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: i == rows.length - 1 ? c.accent : c.surface,
                            border: Border.all(color: i == rows.length - 1 ? c.accent : c.borderStrong, width: 1.5),
                          ),
                        ),
                        if (i < rows.length - 1) Expanded(child: Container(width: 1, color: c.border)),
                      ],
                    ),
                  ),
                  const SizedBox(width: Space.x3),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: Space.x4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(Fmt.status('${rows[i][data.labelField] ?? ''}'), style: t.bodyStrong),
                              ),
                              Text(
                                Fmt.dateTime('${rows[i][data.atField] ?? ''}'),
                                style: t.caption.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                              ),
                            ],
                          ),
                          if (data.noteField != null && rows[i][data.noteField] != null)
                            Text('${rows[i][data.noteField]}', style: t.bodySecondary),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class RecordSkeleton extends StatelessWidget {
  const RecordSkeleton({super.key, this.fields = 6});
  final int fields;

  @override
  Widget build(BuildContext context) => ErpSurface(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SkeletonBlock(width: 200, height: 20),
        const SizedBox(height: Space.x4),
        Wrap(
          spacing: Space.x6,
          runSpacing: Space.x4,
          children: [
            for (var i = 0; i < fields; i++)
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SkeletonBlock(width: 64, height: 10),
                  SizedBox(height: Space.x1),
                  SkeletonBlock(width: 120, height: 14),
                ],
              ),
          ],
        ),
      ],
    ),
  );
}
