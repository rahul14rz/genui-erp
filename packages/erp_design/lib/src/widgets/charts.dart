import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../catalog/generated.dart' as g;
import '../format.dart';
import '../theme.dart';
import '../tokens.dart';
import 'primitives.dart';

num _num(Object? v) => v is num ? v : num.tryParse('$v') ?? 0;

/// Rounds a range out to "nice" tick steps so axis labels read cleanly.
List<double> niceTicks(double max, {int count = 4}) {
  if (max <= 0) return [0, 1];
  final raw = max / count;
  final mag = math.pow(10, (math.log(raw) / math.ln10).floor()).toDouble();
  final step = [1, 2, 2.5, 5, 10].map((m) => m * mag).firstWhere((s) => s >= raw);
  return [for (var v = 0.0; v <= max + step * 0.999; v += step) v];
}

class TrendChartView extends StatelessWidget {
  const TrendChartView(this.data, {super.key});

  final g.TrendChart data;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = context.type;
    final palette = [c.accent, c.textSecondary];
    return ErpSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (data.title != null) SectionTitle(data.title!),
          Wrap(
            spacing: Space.x4,
            children: [
              for (var i = 0; i < data.series.length; i++)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(width: 10, height: 2, color: palette[i]),
                    const SizedBox(width: Space.x1 + 2),
                    Text(data.series[i].label, style: t.caption.copyWith(color: c.textSecondary)),
                  ],
                ),
            ],
          ),
          const SizedBox(height: Space.x3),
          Semantics(
            label: _describe(),
            child: SizedBox(
              height: 220,
              child: CustomPaint(
                size: Size.infinite,
                painter: _TrendPainter(
                  data: data,
                  palette: palette,
                  grid: c.border,
                  label: t.caption.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _describe() {
    final s = data.series.first;
    final points = data.rows.map((r) => '${r[data.xField]}: ${Fmt.format(s.format, _num(r[s.field]), compact: true)}');
    return '${data.title ?? s.label}. ${points.join(', ')}';
  }
}

class _TrendPainter extends CustomPainter {
  _TrendPainter({required this.data, required this.palette, required this.grid, required this.label});

  final g.TrendChart data;
  final List<Color> palette;
  final Color grid;
  final TextStyle label;

  TextPainter _text(String s) => TextPainter(
    text: TextSpan(text: s, style: label),
    textDirection: TextDirection.ltr,
  )..layout();

  @override
  void paint(Canvas canvas, Size size) {
    final rows = data.rows;
    if (rows.isEmpty) return;
    final maxValue = [
      for (final s in data.series)
        for (final r in rows) _num(r[s.field]).toDouble(),
    ].fold<double>(0, math.max);
    final ticks = niceTicks(maxValue);
    final top = ticks.last;
    final fmt = data.series.first.format;
    final yLabels = [for (final v in ticks) _text(Fmt.format(fmt, v, compact: true))];
    final left = yLabels.map((p) => p.width).fold<double>(0, math.max) + Space.x2;
    const bottom = 20.0;
    final plot = Rect.fromLTRB(left, 6, size.width, size.height - bottom);
    final gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;

    for (var i = 0; i < ticks.length; i++) {
      final y = plot.bottom - ticks[i] / top * plot.height;
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), gridPaint);
      yLabels[i].paint(canvas, Offset(left - Space.x2 - yLabels[i].width, y - yLabels[i].height / 2));
    }

    final n = rows.length;
    final slot = plot.width / n;
    final every = math.max(1, (n / (plot.width / 64)).ceil());
    for (var i = 0; i < n; i += every) {
      final p = _text('${rows[i][data.xField]}');
      final x = plot.left + slot * (i + 0.5) - p.width / 2;
      p.paint(canvas, Offset(x.clamp(plot.left, plot.right - p.width), plot.bottom + 4));
    }

    for (var s = 0; s < data.series.length; s++) {
      final series = data.series[s];
      final color = palette[s];
      final values = [for (final r in rows) _num(r[series.field]).toDouble()];
      if (data.kind == g.TrendChartKind.bar) {
        final groupWidth = slot * 0.6;
        final barWidth = groupWidth / data.series.length;
        for (var i = 0; i < n; i++) {
          final h = values[i] / top * plot.height;
          final x = plot.left + slot * i + (slot - groupWidth) / 2 + barWidth * s;
          canvas.drawRRect(
            RRect.fromRectAndCorners(
              Rect.fromLTWH(x, plot.bottom - h, barWidth - 2, h),
              topLeft: const Radius.circular(2),
              topRight: const Radius.circular(2),
            ),
            Paint()..color = color,
          );
        }
      } else {
        final points = [
          for (var i = 0; i < n; i++) Offset(plot.left + slot * (i + 0.5), plot.bottom - values[i] / top * plot.height),
        ];
        final line = Path()..addPolygon(points, false);
        if (s == 0) {
          // A flat 8% tint under the first series. No gradients.
          final area = Path.from(line)
            ..lineTo(points.last.dx, plot.bottom)
            ..lineTo(points.first.dx, plot.bottom)
            ..close();
          canvas.drawPath(area, Paint()..color = color.withValues(alpha: 0.08));
        }
        canvas.drawPath(
          line,
          Paint()
            ..color = color
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2
            ..strokeJoin = StrokeJoin.round,
        );
        for (final p in points) {
          canvas.drawCircle(p, 2.5, Paint()..color = color);
        }
      }
    }
  }

  @override
  bool shouldRepaint(_TrendPainter old) => old.data != data || old.palette != palette;
}

class BreakdownBarView extends StatelessWidget {
  const BreakdownBarView(this.data, {super.key});

  final g.BreakdownBar data;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = context.type;
    final rows = [...data.rows]..sort((a, b) => _num(b[data.valueField]).compareTo(_num(a[data.valueField])));
    final shown = rows.take(data.limit ?? 8).toList();
    final max = shown.isEmpty ? 1 : _num(shown.first[data.valueField]).toDouble();
    return ErpSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (data.title != null) SectionTitle(data.title!),
          for (final r in shown)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: Space.x1 + 2),
              child: Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: Text('${r[data.labelField] ?? ''}', style: t.body, overflow: TextOverflow.ellipsis),
                  ),
                  const SizedBox(width: Space.x3),
                  Expanded(
                    flex: 4,
                    child: LayoutBuilder(
                      builder: (context, box) {
                        final v = _num(r[data.valueField]).toDouble();
                        return Align(
                          alignment: Alignment.centerLeft,
                          child: Container(
                            height: 8,
                            width: max <= 0 ? 0 : box.maxWidth * (v / max).clamp(0, 1),
                            decoration: BoxDecoration(color: c.accent, borderRadius: Radii.control),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(width: Space.x3),
                  SizedBox(
                    width: 96,
                    child: Text(
                      Fmt.format(data.format, _num(r[data.valueField]), compact: true),
                      style: t.numeric,
                      textAlign: TextAlign.right,
                    ),
                  ),
                ],
              ),
            ),
          if (shown.isEmpty) Text('Nothing to rank for this period.', style: t.bodySecondary),
        ],
      ),
    );
  }
}

class ChartSkeleton extends StatelessWidget {
  const ChartSkeleton({super.key, this.height = 220});
  final double height;

  @override
  Widget build(BuildContext context) => ErpSurface(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SkeletonBlock(width: 160, height: 16),
        const SizedBox(height: Space.x4),
        SkeletonBlock(height: height),
      ],
    ),
  );
}
