"""Precision bounds do not invent labels for unmatched findings, even on controls."""
def precision_bounds(classes):
    assert all(c in ('planted','additional','false','unresolved','duplicate') for c in classes)
    total=len(classes)
    if not total:return None
    true=sum(c in ('planted','additional') for c in classes)
    unknown=classes.count('unresolved')
    return dict(lower=true/total,upper=(true+unknown)/total,published=total,unresolved=unknown)
