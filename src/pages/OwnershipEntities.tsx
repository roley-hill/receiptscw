import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";

type OwnershipEntity = {
  id: string;
  name: string;
  created_at: string;
};

type Property = {
  id: string;
  address: string;
  normalized_address: string;
  ownership_entity_id: string | null;
};

export default function OwnershipEntities() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());
  const [showUnassigned, setShowUnassigned] = useState(false);

  const { data: entities = [], isLoading: entitiesLoading } = useQuery({
    queryKey: ["ownership_entities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ownership_entities")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as OwnershipEntity[];
    },
  });

  const { data: properties = [] } = useQuery({
    queryKey: ["properties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .order("address");
      if (error) throw error;
      return data as Property[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("ownership_entities").insert({ name });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ownership_entities"] });
      setNewName("");
      toast({ title: "Entity created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("ownership_entities").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ownership_entities"] });
      setEditingId(null);
      toast({ title: "Entity updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ownership_entities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ownership_entities"] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      toast({ title: "Entity deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ propertyId, entityId }: { propertyId: string; entityId: string | null }) => {
      const { error } = await supabase
        .from("properties")
        .update({ ownership_entity_id: entityId })
        .eq("id", propertyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      toast({ title: "Property assignment updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleExpand = (id: string) => {
    setExpandedEntities(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const unassignedProperties = properties.filter(p => !p.ownership_entity_id);

  if (entitiesLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ownership Entities</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage ownership entities and assign properties to them for grouped deposit batching.
        </p>
      </div>

      {/* Create new entity */}
      <div className="vault-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Add Ownership Entity</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) createMutation.mutate(newName.trim());
          }}
        >
          <Input
            placeholder="e.g. Radford & Hill LLC"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" size="sm" disabled={!newName.trim() || createMutation.isPending}>
            <Plus className="h-4 w-4 mr-1" />Add
          </Button>
        </form>
      </div>

      {/* Entity list with assigned properties */}
      <div className="space-y-3">
        {entities.map(entity => {
          const entityProperties = properties.filter(p => p.ownership_entity_id === entity.id);
          const isExpanded = expandedEntities.has(entity.id);

          return (
            <div key={entity.id} className="vault-card overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <button onClick={() => toggleExpand(entity.id)} className="text-muted-foreground hover:text-foreground">
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <Building2 className="h-4 w-4 text-accent shrink-0" />

                {editingId === entity.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      className="max-w-xs h-8 text-sm"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateMutation.mutate({ id: entity.id, name: editingName.trim() })}
                      disabled={!editingName.trim()}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="font-semibold text-sm text-foreground flex-1">{entity.name}</span>
                    <span className="text-xs text-muted-foreground">{entityProperties.length} properties</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditingId(entity.id); setEditingName(entity.name); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{entity.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Properties will be unassigned but not deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(entity.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>

              {isExpanded && (
                <div className="border-t border-border">
                  {entityProperties.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4">No properties assigned yet.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Property Address</TableHead>
                          <TableHead className="text-xs w-20">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entityProperties.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm">{p.address}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs text-destructive"
                                onClick={() => assignMutation.mutate({ propertyId: p.id, entityId: null })}
                              >
                                Remove
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unassigned properties */}
      {unassignedProperties.length > 0 && (
        <div className="vault-card overflow-hidden">
          <button
            onClick={() => setShowUnassigned(!showUnassigned)}
            className="flex items-center gap-3 p-4 w-full text-left"
          >
            {showUnassigned ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <span className="font-semibold text-sm text-muted-foreground">Unassigned Properties</span>
            <span className="text-xs text-muted-foreground ml-auto">{unassignedProperties.length} properties</span>
          </button>

          {showUnassigned && (
            <div className="border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Property Address</TableHead>
                    <TableHead className="text-xs w-60">Assign to Entity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unassignedProperties.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{p.address}</TableCell>
                      <TableCell>
                        <Select
                          onValueChange={(val) => assignMutation.mutate({ propertyId: p.id, entityId: val })}
                        >
                          <SelectTrigger className="h-8 text-xs w-48">
                            <SelectValue placeholder="Select entity..." />
                          </SelectTrigger>
                          <SelectContent>
                            {entities.map(e => (
                              <SelectItem key={e.id} value={e.id} className="text-xs">
                                {e.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {entities.length === 0 && (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">
          No ownership entities yet. Create one above to start grouping properties.
        </div>
      )}
    </div>
  );
}
