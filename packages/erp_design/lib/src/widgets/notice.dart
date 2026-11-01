import 'package:flutter/material.dart';

import '../catalog/generated.dart' as g;
import '../theme.dart';
import '../tokens.dart';
import 'primitives.dart';

class NoticeView extends StatelessWidget {
  const NoticeView(this.data, {super.key});

  final g.Notice data;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    final tone = switch (data.tone) {
      g.Tone.info => Tone.info,
      g.Tone.success => Tone.success,
      g.Tone.warning => Tone.warning,
      g.Tone.danger => Tone.danger,
    };
    final (fg, bg) = tone.colors(context);
    final icon = switch (data.tone) {
      g.Tone.info => Icons.info_outline,
      g.Tone.success => Icons.check_circle_outline,
      g.Tone.warning => Icons.warning_amber_outlined,
      g.Tone.danger => Icons.block_outlined,
    };
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(Space.x4),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: Radii.surface,
          border: Border.all(color: fg.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(icon, size: 16, color: fg),
            ),
            const SizedBox(width: Space.x3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(data.title, style: t.bodyStrong),
                  const SizedBox(height: Space.x1),
                  Text(data.body, style: t.bodySecondary),
                  if (data.nextStep != null) ...[
                    const SizedBox(height: Space.x2),
                    Text(data.nextStep!, style: t.body.copyWith(color: fg)),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
