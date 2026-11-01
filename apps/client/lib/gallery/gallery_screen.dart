import 'package:erp_design/erp_design.dart';
import 'package:flutter/material.dart';

/// Dev-only route that renders every catalog component in both themes.
class GalleryScreen extends StatefulWidget {
  const GalleryScreen({super.key, required this.onToggleTheme});

  final VoidCallback onToggleTheme;

  @override
  State<GalleryScreen> createState() => _GalleryScreenState();
}

class _GalleryScreenState extends State<GalleryScreen> {
  bool _skeletons = false;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.x6),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: Breakpoints.column),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('Catalog gallery', style: t.display),
                const SizedBox(height: Space.x3),
                Wrap(spacing: Space.x2, runSpacing: Space.x2, children: [
                  ErpButton(label: 'Toggle theme', onPressed: widget.onToggleTheme),
                  ErpButton(
                    label: _skeletons ? 'Show data' : 'Show skeletons',
                    onPressed: () => setState(() => _skeletons = !_skeletons),
                  ),
                ]),
                const SizedBox(height: Space.x2),
                Text('Every component the agent can render, with sample data.', style: t.bodySecondary),
                const SizedBox(height: Space.x8),
                CatalogGallery(skeletons: _skeletons),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
