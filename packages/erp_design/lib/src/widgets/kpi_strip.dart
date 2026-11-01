import 'package:flutter/material.dart';

import '../catalog/generated.dart' as g;
import '../format.dart';
import '../theme.dart';
import '../tokens.dart';
import 'primitives.dart';

class KpiStripView extends StatelessWidget {
  const KpiStripView(this.data, {super.key});

  final g.KpiStrip data;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return LayoutBuilder(
      builder: (context, box) {
        final perRow = box.maxWidth < Breakpoints.phone ? 2 : data.items.length;
        final cells = [for (final item in data.items) _KpiCell(item)];
        final rows = <Widget>[];
        for (var i = 0; i < cells.length; i += perRow) {
          final slice = cells.sublist(i, (i + perRow).clamp(0, cells.length));
          rows.add(
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var j = 0; j < slice.length; j++) ...[
                    if (j > 0) VerticalDivider(width: 1, thickness: 1, color: c.border),
                    Expanded(child: slice[j]),
                  ],
                ],
              ),
            ),
          );
        }
        return ErpSurface(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              for (var i = 0; i < rows.length; i++) ...[
                if (i > 0) Divider(height: 1, thickness: 1, color: c.border),
                rows[i],
              ],
            ],
          ),
        );
      },
    );
  }
}

class _KpiCell extends StatelessWidget {
  const _KpiCell(this.item);
  final g.KpiStripItem item;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    final c = context.colors;
    final previous = item.previous;
    String? delta;
    Color? deltaColor;
    if (previous != null && previous != 0) {
      final pct = (item.value - previous) / previous.abs() * 100;
      delta = '${pct >= 0 ? '+' : ''}${pct.toStringAsFixed(1)}% vs previous period';
      deltaColor = pct >= 0 ? c.success : c.danger;
    } else if (previous == 0) {
      delta = 'No data for the previous period';
    }
    return Padding(
      padding: const EdgeInsets.all(Space.x4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(item.label, style: t.caption.copyWith(color: c.textSecondary)),
          const SizedBox(height: Space.x1),
          Text(Fmt.format(item.format, item.value, compact: true), style: t.kpi),
          const SizedBox(height: Space.x1),
          Text(
            delta ?? ' ',
            style: t.caption.copyWith(
              color: deltaColor ?? c.textMuted,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class KpiStripSkeleton extends StatelessWidget {
  const KpiStripSkeleton({super.key, this.count = 3});
  final int count;

  @override
  Widget build(BuildContext context) => ErpSurface(
    child: Row(
      children: [
        for (var i = 0; i < count; i++) ...[
          if (i > 0) const SizedBox(width: Space.x6),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonBlock(width: 80, height: 12),
                SizedBox(height: Space.x2),
                SkeletonBlock(width: 120, height: 24),
                SizedBox(height: Space.x2),
                SkeletonBlock(width: 140, height: 12),
              ],
            ),
          ),
        ],
      ],
    ),
  );
}
